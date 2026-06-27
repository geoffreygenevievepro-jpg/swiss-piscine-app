"""Pont vers Odoo : réutilise odoo_client.py (vendoré dans backend/), company_id=5.

Lectures via un client read-only ; écritures (timbrage) via un client read-write
dédié. Toutes les requêtes sont filtrées sur company_id=5 (Swiss Piscine).
"""
import sys
import threading
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from dotenv import load_dotenv

from .config import BACKEND_DIR, settings

# Credentials Odoo depuis le .env du backend ; odoo_client.py est vendoré dans backend/.
load_dotenv(BACKEND_DIR / ".env")
sys.path.insert(0, str(BACKEND_DIR))

from odoo_client import OdooClient  # noqa: E402

TZ = ZoneInfo("Europe/Zurich")  # fuseau métier (affichage + bornes "aujourd'hui")
ODOO_FMT = "%Y-%m-%d %H:%M:%S"   # Odoo stocke les datetimes en UTC naïf

_ro_client: OdooClient | None = None
_rw_client: OdooClient | None = None
_lock = threading.Lock()


def get_client() -> OdooClient:
    """Client Odoo en lecture seule (singleton)."""
    global _ro_client
    with _lock:
        if _ro_client is None:
            c = OdooClient(readonly=True)
            c.authenticate()
            _ro_client = c
        return _ro_client


def get_write_client() -> OdooClient:
    """Client Odoo read-write (singleton) — réservé aux écritures app (timbrage…)."""
    global _rw_client
    with _lock:
        if _rw_client is None:
            c = OdooClient(readonly=False)
            c.authenticate()
            _rw_client = c
        return _rw_client


# --- Helpers temps ---------------------------------------------------------

def _odoo_now() -> str:
    return datetime.now(timezone.utc).strftime(ODOO_FMT)


def _parse_odoo_dt(s: str) -> datetime:
    """Parse un datetime Odoo (UTC naïf) en datetime aware UTC."""
    return datetime.strptime(s, ODOO_FMT).replace(tzinfo=timezone.utc)


def _today_bounds_utc() -> tuple[str, str]:
    """Bornes [début, fin[ du jour local (Europe/Zurich), exprimées en UTC pour Odoo."""
    now_local = datetime.now(TZ)
    start_local = now_local.replace(hour=0, minute=0, second=0, microsecond=0)
    end_local = start_local + timedelta(days=1)
    return (start_local.astimezone(timezone.utc).strftime(ODOO_FMT),
            end_local.astimezone(timezone.utc).strftime(ODOO_FMT))


def _company_domain(company_id: int | None = None) -> list:
    return [["company_id", "=", company_id or settings.company_id]]


# --- Employés --------------------------------------------------------------

def get_employee(hr_employee_id: int) -> dict | None:
    client = get_client()
    company_id = employee_company_id(hr_employee_id)
    domain = [["id", "=", hr_employee_id]] + _company_domain(company_id)
    rows = client.execute_kw(
        "hr.employee", "search_read", [domain],
        {"fields": ["name", "job_title", "work_email", "work_phone",
                    "mobile_phone", "department_id", "user_id"], "limit": 1},
    )
    return rows[0] if rows else None


def _employee_user_id(hr_employee_id: int) -> int | None:
    emp = get_employee(hr_employee_id)
    uid = emp.get("user_id") if emp else None
    return uid[0] if uid else None


def list_employees() -> list[dict]:
    client = get_client()
    return client.execute_kw(
        "hr.employee", "search_read", [_company_domain()],
        {"fields": ["name", "job_title", "work_email", "user_id"], "order": "name"},
    )


# --- Timbrage (hr.attendance) ---------------------------------------------

def _open_attendance(hr_employee_id: int) -> dict | None:
    client = get_client()
    rows = client.execute_kw(
        "hr.attendance", "search_read",
        [[["employee_id", "=", hr_employee_id], ["check_out", "=", False]]],
        {"fields": ["id", "check_in"], "order": "check_in desc", "limit": 1},
    )
    return rows[0] if rows else None


def attendance_status(hr_employee_id: int) -> dict:
    """État du pointage du jour : entré/sorti, depuis quand, total du jour."""
    client = get_client()
    start, end = _today_bounds_utc()
    entries = client.execute_kw(
        "hr.attendance", "search_read",
        [[["employee_id", "=", hr_employee_id], ["check_in", ">=", start], ["check_in", "<", end]]],
        {"fields": ["check_in", "check_out"], "order": "check_in asc"},
    )
    now = datetime.now(timezone.utc)
    today_seconds = 0
    open_since = None
    segments = []
    for e in entries:
        ci = _parse_odoo_dt(e["check_in"])
        ci_local = ci.astimezone(TZ).strftime("%H:%M")
        if e["check_out"]:
            co = _parse_odoo_dt(e["check_out"])
            today_seconds += (co - ci).total_seconds()
            segments.append({"in": ci_local, "out": co.astimezone(TZ).strftime("%H:%M")})
        else:
            today_seconds += (now - ci).total_seconds()
            open_since = ci.isoformat()
            segments.append({"in": ci_local, "out": None})
    return {
        "state": "in" if open_since else "out",
        "open_since": open_since,
        "today_seconds": int(today_seconds),
        "count": len(entries),
        "segments": segments,
    }


def _geo(vals: dict, lat, lng, prefix: str) -> None:
    if lat is not None and lng is not None:
        vals[f"{prefix}_latitude"] = lat
        vals[f"{prefix}_longitude"] = lng


def check_in(hr_employee_id: int, lat=None, lng=None) -> dict:
    """Pointe l'entrée (avec géoloc optionnelle). Idempotent si déjà entré."""
    if _open_attendance(hr_employee_id):
        return attendance_status(hr_employee_id)
    vals = {"employee_id": hr_employee_id, "check_in": _odoo_now()}
    _geo(vals, lat, lng, "in")
    get_write_client().execute_kw("hr.attendance", "create", [vals])
    return attendance_status(hr_employee_id)


def check_out(hr_employee_id: int, lat=None, lng=None) -> dict:
    """Pointe la sortie de la session ouverte (avec géoloc optionnelle)."""
    open_att = _open_attendance(hr_employee_id)
    if open_att:
        vals = {"check_out": _odoo_now()}
        _geo(vals, lat, lng, "out")
        get_write_client().execute_kw("hr.attendance", "write", [[open_att["id"]], vals])
    return attendance_status(hr_employee_id)


def _employee_weekly_hours(hr_employee_id: int) -> float:
    ro = get_client()
    rows = ro.execute_kw("hr.employee", "read", [[hr_employee_id]], {"fields": ["resource_calendar_id"]})
    if rows and rows[0].get("resource_calendar_id"):
        cal = ro.execute_kw("resource.calendar", "read",
                            [[rows[0]["resource_calendar_id"][0]]], {"fields": ["hours_per_week"]})
        if cal and cal[0].get("hours_per_week"):
            return cal[0]["hours_per_week"]
    return 42.5


def attendance_summary(hr_employee_id: int, period: str = "week", offset: int = 0) -> dict:
    """Heures travaillées vs dues sur jour / semaine / mois, par bucket (jour)."""
    now = datetime.now(TZ)
    weekly = _employee_weekly_hours(hr_employee_id)
    daily = weekly / 5

    if period == "day":
        day = (now + timedelta(days=offset)).date()
        start_local = datetime(day.year, day.month, day.day, tzinfo=TZ)
        end_local = start_local + timedelta(days=1)
        dates = [day]
        due_total = daily if day.weekday() < 5 else 0.0
    elif period == "month":
        y, m = now.year, now.month + offset
        while m > 12:
            m -= 12; y += 1
        while m < 1:
            m += 12; y -= 1
        start_local = datetime(y, m, 1, tzinfo=TZ)
        ny, nm = (y + 1, 1) if m == 12 else (y, m + 1)
        end_local = datetime(ny, nm, 1, tzinfo=TZ)
        dates, d = [], start_local.date()
        while d < end_local.date():
            dates.append(d); d += timedelta(days=1)
        due_total = sum(daily for dd in dates if dd.weekday() < 5)
    else:  # week
        monday = (now - timedelta(days=now.weekday())).replace(hour=0, minute=0, second=0, microsecond=0) + timedelta(weeks=offset)
        start_local, end_local = monday, monday + timedelta(days=7)
        dates = [(monday + timedelta(days=i)).date() for i in range(7)]
        due_total = weekly

    start_utc = start_local.astimezone(timezone.utc).strftime(ODOO_FMT)
    end_utc = end_local.astimezone(timezone.utc).strftime(ODOO_FMT)
    ro = get_client()
    atts = ro.execute_kw(
        "hr.attendance", "search_read",
        [[["employee_id", "=", hr_employee_id], ["check_in", ">=", start_utc], ["check_in", "<", end_utc]]],
        {"fields": ["check_in", "worked_hours"]},
    )
    worked_by = {d.isoformat(): 0.0 for d in dates}
    for a in atts:
        day = _parse_odoo_dt(a["check_in"]).astimezone(TZ).date().isoformat()
        if day in worked_by:
            worked_by[day] += a.get("worked_hours") or 0.0

    buckets = []
    for d in dates:
        due = round(daily, 2) if d.weekday() < 5 else 0.0
        w = round(worked_by[d.isoformat()], 2)
        buckets.append({"date": d.isoformat(), "worked": w, "due": due, "solde": round(w - due, 2)})
    worked_total = round(sum(worked_by.values()), 2)
    return {
        "period": period,
        "start": start_local.date().isoformat(),
        "buckets": buckets,
        "worked_total": worked_total,
        "due_total": round(due_total, 1),
        "solde_total": round(worked_total - due_total, 2),
    }


def year_balance(hr_employee_id: int) -> dict:
    """Cumul de l'année en cours : heures réalisées vs dues (à ce jour) + solde.
    Dû approximé (hours_per_week / 5 par jour ouvré écoulé, jours fériés ignorés)."""
    now = datetime.now(TZ)
    weekly = _employee_weekly_hours(hr_employee_id)
    daily = weekly / 5
    start_local = datetime(now.year, 1, 1, tzinfo=TZ)
    start_utc = start_local.astimezone(timezone.utc).strftime(ODOO_FMT)
    now_utc = now.astimezone(timezone.utc).strftime(ODOO_FMT)
    ro = get_client()
    atts = ro.execute_kw(
        "hr.attendance", "search_read",
        [[["employee_id", "=", hr_employee_id], ["check_in", ">=", start_utc], ["check_in", "<", now_utc]]],
        {"fields": ["worked_hours"]},
    )
    worked = round(sum(a.get("worked_hours") or 0.0 for a in atts), 1)
    weekdays, d, today = 0, start_local.date(), now.date()
    while d <= today:
        if d.weekday() < 5:
            weekdays += 1
        d += timedelta(days=1)
    due = round(weekdays * daily, 1)
    return {"year": now.year, "worked": worked, "due": due, "solde": round(worked - due, 1)}


def attendance_days(hr_employee_id: int, num_days: int = 30) -> dict:
    """Heures travaillées + nombre de pointages par jour sur les `num_days`
    derniers jours (aujourd'hui inclus). Pour la bande calendrier de l'onglet Présence."""
    num_days = max(1, min(num_days, 120))
    now = datetime.now(TZ)
    end_local = now.replace(hour=0, minute=0, second=0, microsecond=0) + timedelta(days=1)
    start_local = end_local - timedelta(days=num_days)
    start_utc = start_local.astimezone(timezone.utc).strftime(ODOO_FMT)
    end_utc = end_local.astimezone(timezone.utc).strftime(ODOO_FMT)
    ro = get_client()
    atts = ro.execute_kw(
        "hr.attendance", "search_read",
        [[["employee_id", "=", hr_employee_id], ["check_in", ">=", start_utc], ["check_in", "<", end_utc]]],
        {"fields": ["check_in", "worked_hours"]},
    )
    by: dict = {}
    for a in atts:
        day = _parse_odoo_dt(a["check_in"]).astimezone(TZ).date().isoformat()
        slot = by.setdefault(day, {"worked": 0.0, "count": 0})
        slot["worked"] += a.get("worked_hours") or 0.0
        slot["count"] += 1
    days, d, last = [], start_local.date(), (end_local - timedelta(days=1)).date()
    while d <= last:
        iso = d.isoformat()
        info = by.get(iso, {"worked": 0.0, "count": 0})
        days.append({"date": iso, "worked": round(info["worked"], 2), "count": info["count"]})
        d += timedelta(days=1)
    return {"days": days}


def hours_overview(hr_employee_id: int) -> dict:
    """Réalisé vs dû (écoulé) pour le jour / le mois / l'année, avec % et heures sup.
    Le dû ne compte que les jours ouvrés ÉCOULÉS (pas les mois/jours à venir)."""
    now = datetime.now(TZ)
    weekly = _employee_weekly_hours(hr_employee_id)
    daily = weekly / 5
    year_start = datetime(now.year, 1, 1, tzinfo=TZ)
    start_utc = year_start.astimezone(timezone.utc).strftime(ODOO_FMT)
    now_utc = now.astimezone(timezone.utc).strftime(ODOO_FMT)
    ro = get_client()
    atts = ro.execute_kw(
        "hr.attendance", "search_read",
        [[["employee_id", "=", hr_employee_id], ["check_in", ">=", start_utc], ["check_in", "<", now_utc]]],
        {"fields": ["check_in", "worked_hours"]},
    )
    today = now.date()
    w_day = w_month = w_year = 0.0
    for a in atts:
        d = _parse_odoo_dt(a["check_in"]).astimezone(TZ).date()
        wh = a.get("worked_hours") or 0.0
        w_year += wh
        if d.year == today.year and d.month == today.month:
            w_month += wh
        if d == today:
            w_day += wh

    def weekdays(d0, d1):
        n, d = 0, d0
        while d <= d1:
            if d.weekday() < 5:
                n += 1
            d += timedelta(days=1)
        return n

    due_day = daily if today.weekday() < 5 else 0.0
    due_month = weekdays(today.replace(day=1), today) * daily
    due_year = weekdays(today.replace(month=1, day=1), today) * daily

    def pack(w, due):
        pct = round(w / due * 100) if due > 0 else (100 if w > 0 else 0)
        return {"worked": round(w, 1), "due": round(due, 1), "pct": pct,
                "overtime": round(max(0.0, w - due), 1)}

    return {"day": pack(w_day, due_day), "month": pack(w_month, due_month),
            "year": pack(w_year, due_year)}


# --- Saisie manuelle / édition des pointages (hr.attendance) ---------------
# Édition/suppression réservée aux pointages créés depuis moins de 24 h, et
# uniquement ceux de l'employé courant (cloisonnement).

def attendance_today_detail(hr_employee_id: int, date_iso: str | None = None) -> dict:
    """Pointages du jour : id, horaires locaux, durée, éditabilité (<24 h)."""
    ro = get_client()
    start, end = _day_bounds_utc(date_iso)
    rows = ro.execute_kw(
        "hr.attendance", "search_read",
        [[["employee_id", "=", hr_employee_id], ["check_in", ">=", start], ["check_in", "<", end]]],
        {"fields": ["check_in", "check_out", "worked_hours", "create_date"], "order": "check_in asc"},
    )
    now = datetime.now(timezone.utc)
    items, total = [], 0.0
    for a in rows:
        ci = _parse_odoo_dt(a["check_in"])
        co = _parse_odoo_dt(a["check_out"]) if a.get("check_out") else None
        created = _parse_odoo_dt(a["create_date"]) if a.get("create_date") else ci
        w = round(a.get("worked_hours") or 0, 2)
        total += w
        items.append({
            "id": a["id"],
            "in": ci.astimezone(TZ).strftime("%H:%M"),
            "out": co.astimezone(TZ).strftime("%H:%M") if co else None,
            "worked": w,
            "open": co is None,
            "editable": (now - created) < timedelta(hours=24),
        })
    day = date_iso or datetime.now(TZ).date().isoformat()
    return {"date": day, "attendances": items, "total": round(total, 2)}


def attendance_overlaps(hr_employee_id: int, start_utc: str, end_utc: str,
                        exclude_id: int | None = None) -> bool:
    """True si un pointage (fermé) de l'employé chevauche [start, end[."""
    ro = get_client()
    domain = [["employee_id", "=", hr_employee_id],
              ["check_in", "<", end_utc], ["check_out", ">", start_utc]]
    if exclude_id:
        domain.append(["id", "!=", exclude_id])
    return bool(ro.execute_kw("hr.attendance", "search_read", [domain], {"fields": ["id"], "limit": 1}))


def _attendance_editable(hr_employee_id: int, att_id: int) -> bool | None:
    """None si introuvable/non possédé ; sinon True/False selon la règle des 24 h."""
    ro = get_client()
    rows = ro.execute_kw(
        "hr.attendance", "search_read",
        [[["id", "=", att_id], ["employee_id", "=", hr_employee_id]]],
        {"fields": ["create_date"], "limit": 1},
    )
    if not rows:
        return None
    created = _parse_odoo_dt(rows[0]["create_date"]) if rows[0].get("create_date") else None
    return created is None or (datetime.now(timezone.utc) - created) < timedelta(hours=24)


def create_manual_attendance(hr_employee_id: int, start_utc: str, end_utc: str) -> dict:
    """Crée un pointage manuel (saisie d'heures oubliées). ÉCRITURE."""
    aid = get_write_client().execute_kw(
        "hr.attendance", "create",
        [{"employee_id": hr_employee_id, "check_in": start_utc, "check_out": end_utc}])
    return {"id": aid}


def update_attendance(hr_employee_id: int, att_id: int, start_utc: str, end_utc: str) -> dict:
    """Modifie un pointage de l'employé (si <24 h). ÉCRITURE."""
    ed = _attendance_editable(hr_employee_id, att_id)
    if ed is None:
        return {"error": "not_found"}
    if not ed:
        return {"error": "locked"}
    get_write_client().execute_kw(
        "hr.attendance", "write", [[att_id], {"check_in": start_utc, "check_out": end_utc}])
    return {"ok": True}


def delete_attendance(hr_employee_id: int, att_id: int) -> dict:
    """Supprime un pointage de l'employé (si <24 h). ÉCRITURE."""
    ed = _attendance_editable(hr_employee_id, att_id)
    if ed is None:
        return {"error": "not_found"}
    if not ed:
        return {"error": "locked"}
    get_write_client().execute_kw("hr.attendance", "unlink", [[att_id]])
    return {"ok": True}


# --- Interventions (planning.slot) ----------------------------------------
# Les interventions sont planifiées dans le module Planning. Le filtrage se fait
# sur employee_ids (hr.employee), donc fonctionne même pour les employés sans
# compte utilisateur Odoo.

_SLOT_FIELDS = ["start_datetime", "end_datetime", "partner_id", "project_id",
                "task_id", "role_id", "name", "allocated_hours", "state"]
ROLE_TECHNICIEN_ID = 34  # planning.role "Technicien"
_PARTNER_FIELDS = ["name", "street", "street2", "zip", "city", "phone", "email"]


def _slot_label(slot: dict) -> str:
    """Libellé lisible d'un créneau : description libre, sinon tâche/chantier."""
    if slot.get("name"):
        return slot["name"]
    for key in ("task_id", "project_id", "partner_id"):
        if slot.get(key):
            return slot[key][1]
    return "Intervention"


def local_dt_to_utc(date_str: str, time_str: str) -> str:
    """Convertit une date+heure locale (Europe/Zurich) en datetime Odoo (UTC)."""
    local = datetime.strptime(f"{date_str} {time_str}", "%Y-%m-%d %H:%M").replace(tzinfo=TZ)
    return local.astimezone(timezone.utc).strftime(ODOO_FMT)


def _day_bounds_utc(date_iso: str | None) -> tuple[str, str]:
    """Bornes UTC [00:00, 24:00[ du jour local donné (ou aujourd'hui si None)."""
    if date_iso:
        d = datetime.strptime(date_iso, "%Y-%m-%d").date()
        start_local = datetime(d.year, d.month, d.day, tzinfo=TZ)
        end_local = start_local + timedelta(days=1)
        return (start_local.astimezone(timezone.utc).strftime(ODOO_FMT),
                end_local.astimezone(timezone.utc).strftime(ODOO_FMT))
    return _today_bounds_utc()


def today_interventions(hr_employee_id: int, date_iso: str | None = None) -> dict:
    """Créneaux planifiés du jour choisi (par défaut aujourd'hui) pour l'employé."""
    client = get_client()
    company_id = employee_company_id(hr_employee_id)
    start, end = _day_bounds_utc(date_iso)
    domain = [
        ["employee_ids", "in", [hr_employee_id]],
        ["start_datetime", ">=", start],
        ["start_datetime", "<", end],
    ] + _company_domain(company_id)
    slots = client.execute_kw(
        "planning.slot", "search_read", [domain],
        {"fields": _SLOT_FIELDS, "order": "start_datetime asc"},
    )
    for s in slots:
        s["label"] = _slot_label(s)
    return {"interventions": slots}


def intervention_detail(slot_id: int, hr_employee_id: int) -> dict | None:
    """Détail d'un créneau + infos client (tout créneau de la société, pour rapport)."""
    client = get_client()
    company_id = employee_company_id(hr_employee_id)
    domain = [["id", "=", slot_id]] + _company_domain(company_id)
    rows = client.execute_kw(
        "planning.slot", "search_read", [domain],
        {"fields": _SLOT_FIELDS + ["employee_ids"], "limit": 1},
    )
    if not rows:
        return None
    slot = rows[0]
    slot["label"] = _slot_label(slot)
    slot["partner"] = None
    slot["history"] = []
    slot["known_issues"] = None
    if slot.get("partner_id"):
        pid = slot["partner_id"][0]
        prows = client.execute_kw(
            "res.partner", "read", [[pid]], {"fields": _PARTNER_FIELDS + ["comment"]},
        )
        if prows:
            slot["partner"] = prows[0]
            slot["known_issues"] = _html_to_text(prows[0].get("comment")) or None
        slot["history"] = client_history(pid, company_id=company_id)
    return slot


_STATUS_LABELS = {"done": "✅ Tâche terminée", "todo": "🟠 Tâche à terminer"}


def _build_intervention_html(description, client_name, status, products,
                             discount, vat_rate, tag_names, employee_name,
                             worker_names=None) -> str:
    """Note récapitulative de l'intervention (chatter du créneau) : infos + tableau produits."""
    html = ["<p><strong>🧰 Intervention</strong></p><ul>"]
    if employee_name:
        html.append(f"<li><strong>Saisi par :</strong> {_esc(employee_name)}</li>")
    if worker_names:
        html.append(f"<li><strong>Équipe sur le chantier :</strong> {_esc(', '.join(worker_names))}</li>")
    if client_name:
        html.append(f"<li><strong>Client :</strong> {_esc(client_name)}</li>")
    if status in _STATUS_LABELS:
        html.append(f"<li><strong>Statut :</strong> {_esc(_STATUS_LABELS[status])}</li>")
    if tag_names:
        html.append(f"<li><strong>Tags :</strong> {_esc(', '.join(tag_names))}</li>")
    html.append("</ul>")
    if description:
        html.append(f"<p><strong>Description :</strong><br>{_esc(description)}</p>")
    lines = [p for p in products if (p.get("name") or "").strip()]
    if lines:
        subtotal, rows = 0.0, []
        for p in lines:
            qty = float(p.get("qty") or 0)
            price = float(p.get("price") or 0)
            lt = qty * price
            subtotal += lt
            rows.append(
                f"<tr><td>{_esc(p['name'])}</td><td style='text-align:right'>{qty:g}</td>"
                f"<td style='text-align:right'>{price:.2f}</td>"
                f"<td style='text-align:right'>{lt:.2f}</td></tr>")
        disc_amt = subtotal * (discount or 0) / 100
        after = subtotal - disc_amt
        vat_amt = after * (vat_rate or 0) / 100
        total = after + vat_amt
        html.append("<p><strong>Produits</strong></p>")
        html.append("<table border='1' cellpadding='4' style='border-collapse:collapse'>"
                    "<tr><th>Produit</th><th>Qté</th><th>PU</th><th>Total</th></tr>"
                    + "".join(rows) + "</table><ul>")
        summary = [("Sous-total", subtotal)]
        if discount:
            summary.append((f"Remise {discount:g}%", -disc_amt))
        summary.append((f"TVA {vat_rate:g}%", vat_amt))
        summary.append(("Total", total))
        for lbl, val in summary:
            html.append(f"<li><strong>{_esc(lbl)} :</strong> {val:.2f} CHF</li>")
        html.append("</ul>")
    return "".join(html)


_income_account_cache: dict[str, int | None] = {}


def _default_income_account() -> int | None:
    """Compte de produits par défaut (pour les lignes de facture sans produit catalogue)."""
    if "id" not in _income_account_cache:
        ro = get_client()
        try:
            rows = ro.execute_kw("account.account", "search_read",
                                 [[["account_type", "=", "income"]]], {"fields": ["id"], "limit": 1})
            _income_account_cache["id"] = rows[0]["id"] if rows else None
        except Exception:
            _income_account_cache["id"] = None
    return _income_account_cache["id"]


def create_draft_invoice(partner_id: int, products: list[dict], discount: float = 0.0,
                         origin: str | None = None,
                         company_id: int | None = None) -> int:
    """Crée une facture client BROUILLON (account.move, move_type=out_invoice).

    Lignes catalogue → product_id (Odoo calcule compte + taxes) ; lignes libres → nom +
    compte de produits par défaut. Jamais validée : le bureau relit et comptabilise.
    """
    rw = get_write_client()
    disc = float(discount or 0)
    lines = []
    fallback_acc = None
    for p in products:
        line = {"name": p.get("name") or "Article",
                "quantity": float(p.get("qty") or 1), "discount": disc}
        if p.get("price") is not None:
            line["price_unit"] = float(p["price"])
        if p.get("product_id"):
            line["product_id"] = int(p["product_id"])
        else:
            if fallback_acc is None:
                fallback_acc = _default_income_account()
            if fallback_acc:
                line["account_id"] = fallback_acc
        lines.append((0, 0, line))
    vals = {
        "move_type": "out_invoice",
        "partner_id": partner_id,
        "company_id": company_id or settings.company_id,
        "invoice_line_ids": lines,
    }
    if origin:
        vals["invoice_origin"] = origin
    return rw.execute_kw("account.move", "create", [vals])


def create_intervention(hr_employee_id: int, name: str, start_utc: str, end_utc: str,
                        *, partner_id: int | None = None, client_name: str | None = None,
                        type_label: str | None = None, photos: list[str] | None = None,
                        products: list[dict] | None = None, discount: float = 0.0,
                        vat_rate: float = 8.1, tag_ids: list[int] | None = None,
                        signature: str | None = None, status: str | None = None,
                        employee_name: str = "", worker_ids: list[int] | None = None,
                        materials: str | None = None, next_action: str | None = None,
                        next_action_date: str | None = None, schedule: str | None = None) -> dict:
    """Crée un planning.slot (rôle Technicien, société de l'employé) + remplit la FICHE de chantier
    (worksheet) + note récap + pièces jointes (photos/signature) + facture brouillon si
    « à facturer ». Le client libre n'est créé que pour facturer."""
    company_id = employee_company_id(hr_employee_id)
    workers = [int(w) for w in (worker_ids or [])] or [hr_employee_id]
    title_bits = [b for b in [type_label, client_name] if b]
    label = " — ".join(title_bits) or name or "Intervention"
    vals = {
        "employee_ids": [(6, 0, workers)],
        "start_datetime": start_utc,
        "end_datetime": end_utc,
        "company_id": company_id,
        "role_id": ROLE_TECHNICIEN_ID,
        "name": label,
    }
    if partner_id:
        vals["partner_id"] = partner_id
    rw = get_write_client()
    try:
        slot_id = rw.execute_kw("planning.slot", "create", [vals])
    except Exception as e:
        # Client rattaché à une autre société → on crée le créneau sans le lier
        # (le nom du client reste dans le titre). Évite le blocage multi-sociétés.
        msg = str(e).lower()
        if partner_id and ("société" in msg or "company" in msg or "_check_company" in msg):
            vals.pop("partner_id", None)
            if client_name and client_name not in label:
                vals["name"] = f"{label} — {client_name}"
            slot_id = rw.execute_kw("planning.slot", "create", [vals])
            partner_id = None  # partner incompatible : non réutilisé pour la facture
        else:
            raise

    att_ids: list[int] = []
    for i, photo in enumerate(photos or []):
        att_ids.append(rw.execute_kw("ir.attachment", "create", [{
            "name": f"photo_{i + 1}.jpg", "datas": _strip_data_url(photo),
            "res_model": "planning.slot", "res_id": slot_id, "mimetype": "image/jpeg",
        }]))
    if signature:
        att_ids.append(rw.execute_kw("ir.attachment", "create", [{
            "name": "signature_client.png", "datas": _strip_data_url(signature),
            "res_model": "planning.slot", "res_id": slot_id, "mimetype": "image/png",
        }]))

    tag_names = [t["name"] for t in REPORT_TAGS if t["id"] in (tag_ids or [])]
    worker_names = []
    try:
        rows = get_client().execute_kw("hr.employee", "read", [workers], {"fields": ["name"]})
        worker_names = [r["name"] for r in rows]
    except Exception:
        worker_names = []
    body = _build_intervention_html(
        description=name, client_name=client_name, status=status,
        products=products or [], discount=discount, vat_rate=vat_rate,
        tag_names=tag_names, employee_name=employee_name, worker_names=worker_names)
    if body:
        rw.execute_kw("planning.slot", "message_post", [[slot_id]],
                      {"body": body, "attachment_ids": att_ids})

    # --- Fiche de chantier (worksheet) remplie comme via un rapport ---
    worksheet_ok = False
    try:
        dur = None
        try:
            s = datetime.strptime(start_utc, "%Y-%m-%d %H:%M:%S")
            e = datetime.strptime(end_utc, "%Y-%m-%d %H:%M:%S")
            dur = round((e - s).total_seconds() / 3600, 2)
        except Exception:
            dur = None
        report_like = {
            "type": type_label,
            "hours": dur,
            "schedule": schedule,
            "worker_names": worker_names,
            "notes": name,
            "materials": materials,
            "parts": [p.get("name") for p in (products or []) if p.get("name")],
            "tag_names": tag_names,
            "next_action": next_action,
            "next_action_date": next_action_date,
            "signature": signature,
        }
        slot_ctx = {"start_datetime": start_utc, "partner_id": [partner_id or 0, client_name or "Client"]}
        _fill_worksheet(get_client(), rw, slot_id, slot_ctx, report_like)
        worksheet_ok = True
    except Exception:
        worksheet_ok = False

    # --- Facturation : facture client BROUILLON si tag « à facturer » + produits ---
    invoice_id = None
    billable = bool(products) and any((n or "").lower() == "à facturer" for n in tag_names)
    if billable:
        bill_partner = partner_id
        if not bill_partner and client_name:
            # Client absent de la liste Odoo → on le crée avant de facturer.
            try:
                bill_partner = create_partner(client_name)
                rw.execute_kw("planning.slot", "write", [[slot_id], {"partner_id": bill_partner}])
            except Exception:
                bill_partner = None
        if bill_partner:
            try:
                invoice_id = create_draft_invoice(bill_partner, products, discount, origin=label, company_id=company_id)
                rw.execute_kw("planning.slot", "message_post", [[slot_id]],
                              {"body": "<p><strong>Facture brouillon créée</strong> — à vérifier et valider par le bureau.</p>"})
            except Exception:
                invoice_id = None

    return {"id": slot_id, "worksheet": worksheet_ok,
            "invoice": bool(invoice_id), "invoice_id": invoice_id}


_emp_company_cache: dict[int, int] = {}


def employee_company_id(hr_employee_id: int) -> int:
    """Société (res.company id) de l'employé connecté. Repli : société configurée."""
    if hr_employee_id not in _emp_company_cache:
        try:
            rows = get_client().execute_kw("hr.employee", "read", [[hr_employee_id]],
                                           {"fields": ["company_id"]})
            c = rows[0].get("company_id") if rows else None
            _emp_company_cache[hr_employee_id] = c[0] if c else settings.company_id
        except Exception:
            _emp_company_cache[hr_employee_id] = settings.company_id
    return _emp_company_cache[hr_employee_id]


def search_partners(query: str, company_id: int | None = None, limit: int = 15) -> list[dict]:
    """Recherche de clients (res.partner) par nom ou ville, pour le formulaire.

    Restreint aux partenaires compatibles avec la société de l'employé (partagés ou
    cette société), pour éviter les conflits multi-sociétés à la création (_check_company).
    """
    client = get_client()
    cid = company_id or settings.company_id
    domain = ["&",
              "|", ["company_id", "=", False], ["company_id", "=", cid],
              "|", ["name", "ilike", query], ["city", "ilike", query]]
    return client.execute_kw(
        "res.partner", "search_read", [domain],
        {"fields": ["name", "city", "street", "zip"], "limit": limit, "order": "name"},
    )


def create_partner(name: str, zip_code: str | None = None, city: str | None = None,
                   street: str | None = None, phone: str | None = None,
                   email: str | None = None) -> int:
    """Crée un client (res.partner) et renvoie son id. ÉCRITURE — réservée à la
    création d'une intervention imprévue avec un nouveau client."""
    vals = {"name": name}
    if zip_code:
        vals["zip"] = zip_code
    if city:
        vals["city"] = city
    if street:
        vals["street"] = street
    if phone:
        vals["phone"] = phone
    if email:
        vals["email"] = email
    return get_write_client().execute_kw("res.partner", "create", [vals])


# --- Contexte client (historique, problèmes connus) -----------------------

def _html_to_text(html: str | None) -> str:
    """Convertit un champ HTML Odoo (res.partner.comment) en texte simple."""
    import re
    if not html:
        return ""
    txt = re.sub(r"<br\s*/?>", "\n", html, flags=re.IGNORECASE)
    txt = re.sub(r"</p>", "\n", txt, flags=re.IGNORECASE)
    txt = re.sub(r"<[^>]+>", " ", txt)
    for a, b in (("&nbsp;", " "), ("&amp;", "&"), ("&lt;", "<"), ("&gt;", ">"), ("&#39;", "'")):
        txt = txt.replace(a, b)
    lines = [" ".join(l.split()) for l in txt.splitlines()]
    return "\n".join(l for l in lines if l).strip()


def client_history(partner_id: int, limit: int = 3, company_id: int | None = None) -> list[dict]:
    """Les dernières tâches Odoo du client (project.task) : date, libellé, étape."""
    ro = get_client()
    tasks = ro.execute_kw(
        "project.task", "search_read",
        [[["partner_id", "=", partner_id]] + _company_domain(company_id)],
        {"fields": ["name", "stage_id", "create_date", "date_deadline"],
         "order": "create_date desc", "limit": limit},
    )
    out = []
    for t in tasks:
        d = (t.get("date_deadline") or t.get("create_date") or "")[:10]
        out.append({
            "name": t.get("name"),
            "date": d,
            "stage": t["stage_id"][1] if t.get("stage_id") else None,
        })
    return out


def slot_overlaps(hr_employee_id: int, start_utc: str, end_utc: str,
                  exclude_id: int | None = None) -> dict | None:
    """Renvoie un créneau de l'employé qui chevauche [start, end[, sinon None."""
    ro = get_client()
    company_id = employee_company_id(hr_employee_id)
    domain = [["employee_ids", "in", [hr_employee_id]],
              ["start_datetime", "<", end_utc],
              ["end_datetime", ">", start_utc]] + _company_domain(company_id)
    if exclude_id:
        domain.append(["id", "!=", exclude_id])
    rows = ro.execute_kw(
        "planning.slot", "search_read", [domain],
        {"fields": ["start_datetime", "end_datetime", "name"], "order": "start_datetime", "limit": 1},
    )
    return rows[0] if rows else None


# --- Rapport d'intervention -----------------------------------------------

# Tags proposés sur le rapport d'intervention (project.tags réels dans Odoo heiwa).
# Posés sur la project.task cible du rapport. Ids fixes (créés/validés le 2026-06-25).
REPORT_TAGS = [
    {"id": 67, "name": "à facturer"},
    {"id": 80, "name": "SAV SP"},
    {"id": 81, "name": "SAV client"},
]


REPORT_TYPES = [
    "Mise en service", "Entretien", "Dépannage", "Hivernage", "SAV", "Montage",
    "Bétonage", "Local technique", "Préparation Piscine", "PVC", "Pose Volet",
]


def _strip_data_url(b64: str) -> str:
    """Enlève l'éventuel préfixe data:...;base64, d'une image."""
    return b64.split(",", 1)[1] if b64.startswith("data:") else b64


def _esc(s: str) -> str:
    return (str(s or "").replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;"))


_NEXT_ACTION_LABELS = {
    "rappel": "Rappel client",
    "appel": "Appel client",
    "devis": "Devis SAV à établir",
}


def _build_report_html(report: dict, employee_name: str) -> str:
    parts = report.get("parts") or []
    rows = [
        ("Type d'intervention", report.get("type")),
        ("Technicien", employee_name),
        ("Équipe sur le chantier", ", ".join(report.get("worker_names") or []) or None),
        ("Horaire", report.get("schedule")),
        ("Durée", f'{report["hours"]:.2f} h' if report.get("hours") else None),
        ("Matériel utilisé", report.get("materials")),
        ("Pièces utilisées", ", ".join(parts) if parts else None),
        ("Tags", ", ".join(report.get("tag_names") or []) or None),
    ]
    html = ["<p><strong>📋 Rapport d'intervention</strong></p><ul>"]
    for label, val in rows:
        if val:
            html.append(f"<li><strong>{_esc(label)} :</strong> {_esc(val)}</li>")
    html.append("</ul>")
    if report.get("notes"):
        html.append(f"<p><strong>Notes :</strong><br>{_esc(report['notes'])}</p>")
    next_action = report.get("next_action")
    if next_action in _NEXT_ACTION_LABELS:
        when = report.get("next_action_date")
        suffix = f" — {_esc(when)}" if when else ""
        html.append(f"<p><strong>Prochaine action :</strong> {_esc(_NEXT_ACTION_LABELS[next_action])}{suffix}</p>")
    return "".join(html)


def _slot_target(slot: dict, slot_id: int) -> tuple[str, int]:
    """Record Odoo où ranger le rapport : tâche > chantier > client > créneau."""
    if slot.get("task_id"):
        return "project.task", slot["task_id"][0]
    if slot.get("project_id"):
        return "project.project", slot["project_id"][0]
    if slot.get("partner_id"):
        return "res.partner", slot["partner_id"][0]
    return "planning.slot", slot_id


# Cache des ids ir.model (requis pour mail.activity.res_model_id).
_model_id_cache: dict[str, int | None] = {}


def _model_id(model: str) -> int | None:
    if model not in _model_id_cache:
        ro = get_client()
        try:
            rows = ro.execute_kw("ir.model", "search_read", [[["model", "=", model]]],
                                 {"fields": ["id"], "limit": 1})
            _model_id_cache[model] = rows[0]["id"] if rows else None
        except Exception:
            # Le compte de service n'a pas accès à ir.model → activité ignorée (best-effort).
            _model_id_cache[model] = None
    return _model_id_cache[model]


# next_action → (activity_type_id, résumé, échéance par défaut en jours)
_ACTIVITY_MAP = {
    "rappel": (4, "Rappel client", 7),       # To-Do
    "appel": (2, "Appeler le client", 2),     # Call
    "devis": (4, "Établir un devis SAV", 1),  # To-Do
}


def _create_next_activity(rw, model: str, rid: int, next_action: str | None,
                          date_iso: str | None) -> bool:
    """Planifie une activité Odoo (rappel/appel/devis) sur le record. Best-effort."""
    if next_action not in _ACTIVITY_MAP:
        return False
    if model not in ("project.task", "project.project", "res.partner"):
        return False  # planning.slot ne porte pas d'activité
    model_id = _model_id(model)
    if not model_id:
        return False
    type_id, summary, default_days = _ACTIVITY_MAP[next_action]
    deadline = date_iso or (datetime.now(TZ).date() + timedelta(days=default_days)).isoformat()
    try:
        rw.execute_kw("mail.activity", "create", [{
            "res_model": model, "res_model_id": model_id, "res_id": rid,
            "activity_type_id": type_id, "summary": summary, "date_deadline": deadline,
        }])
        return True
    except Exception:
        return False


def search_report_products(query: str, limit: int = 20) -> list[dict]:
    """Recherche de produits/pièces (product.product) pour la checklist du rapport."""
    ro = get_client()
    domain = ["|", ["company_id", "=", settings.company_id], ["company_id", "=", False],
              ["name", "ilike", query]]
    return ro.execute_kw(
        "product.product", "search_read", [domain],
        {"fields": ["name", "default_code", "list_price"], "limit": limit, "order": "name"},
    )


_WS_TEMPLATE_NAME = "Rapport d'intervention"
_ws_template_cache: dict[str, int | None] = {}


def _intervention_ws_template_id(ro) -> int | None:
    """Id du modèle de fiche 'Rapport d'intervention' (planning.slot), mis en cache."""
    if "id" not in _ws_template_cache:
        rows = ro.execute_kw(
            "worksheet.template", "search_read",
            [[["name", "=", _WS_TEMPLATE_NAME], ["res_model", "=", "planning.slot"]]],
            {"fields": ["id"], "limit": 1})
        _ws_template_cache["id"] = rows[0]["id"] if rows else None
    return _ws_template_cache["id"]


def _fill_worksheet(ro, rw, slot_id: int, slot: dict, report: dict) -> None:
    """Remplit la fiche d'intervention native Odoo (worksheet) du créneau.

    Mappe les champs du rapport sur les propriétés du template (repérées par libellé,
    robuste aux hashes). Renseigne aussi la signature client si présente.
    """
    tid = _intervention_ws_template_id(ro)
    if not tid:
        return
    # Assigne le template puis relit la définition fusionnée (avec tous les champs).
    rw.execute_kw("planning.slot", "write", [[slot_id], {"worksheet_template_id": tid}])
    props = ro.execute_kw("planning.slot", "read", [[slot_id]],
                          {"fields": ["worksheet_properties"]})[0].get("worksheet_properties") or []

    parts = report.get("parts") or []
    na = report.get("next_action")
    na_lbl = _NEXT_ACTION_LABELS.get(na) if na else None
    if na_lbl and report.get("next_action_date"):
        na_lbl = f"{na_lbl} — {report['next_action_date']}"

    by_label = {
        "Type d'intervention": report.get("type"),
        "Temps d'intervention": slot.get("start_datetime") or False,
        "Durée (h)": float(report["hours"]) if report.get("hours") else None,
        "Horaire": report.get("schedule"),
        "Équipe sur le chantier": ", ".join(report.get("worker_names") or []) or None,
        "Tâches réalisées": report.get("notes"),
        "Matériel utilisé": report.get("materials"),
        "Pièces utilisées": ", ".join(parts) if parts else None,
        "Tags": ", ".join(report.get("tag_names") or []) or None,
        "Prochaine action": na_lbl,
    }
    for p in props:
        v = by_label.get(p.get("string"))
        if v is not None:
            p["value"] = v

    vals = {"worksheet_properties": props}
    if report.get("signature"):
        vals["worksheet_signature"] = _strip_data_url(report["signature"])
        partner = slot.get("partner_id")
        vals["worksheet_signed_by"] = partner[1] if partner else "Client"
    rw.execute_kw("planning.slot", "write", [[slot_id], vals])


def submit_report(hr_employee_id: int, employee_name: str, slot_id: int, report: dict) -> dict | None:
    """Enregistre le rapport dans Odoo : note chatter + photos/signature + temps.

    Restreint au créneau assigné à l'employé. Renvoie None si non autorisé.
    """
    company_id = employee_company_id(hr_employee_id)
    ro = get_client()
    rows = ro.execute_kw(
        "planning.slot", "search_read",
        [[["id", "=", slot_id]] + _company_domain(company_id)],
        {"fields": ["task_id", "project_id", "partner_id", "name", "start_datetime", "employee_ids"], "limit": 1},
    )
    if not rows:
        return None
    slot = rows[0]
    model, rid = _slot_target(slot, slot_id)
    rw = get_write_client()

    # Tags choisis (project.tags) : noms pour la note + écriture sur la tâche/chantier.
    tag_ids = [int(t) for t in (report.get("tag_ids") or [])]
    report["tag_names"] = [t["name"] for t in REPORT_TAGS if t["id"] in tag_ids]

    # Employés ayant travaillé : mise à jour du créneau + noms pour la note.
    worker_ids = [int(w) for w in (report.get("worker_ids") or [])]
    if worker_ids:
        try:
            rw.execute_kw("planning.slot", "write", [[slot_id], {"employee_ids": [(6, 0, worker_ids)]}])
        except Exception:
            pass
        try:
            report["worker_names"] = [r["name"] for r in
                                      ro.execute_kw("hr.employee", "read", [worker_ids], {"fields": ["name"]})]
        except Exception:
            report["worker_names"] = []
    elif slot.get("employee_ids"):
        # Aucun employé re-précisé → on reprend l'équipe déjà assignée au créneau,
        # pour que la fiche montre toujours qui a travaillé (cohérence avec « Je fais »).
        try:
            report["worker_names"] = [r["name"] for r in
                                      ro.execute_kw("hr.employee", "read", [slot["employee_ids"]], {"fields": ["name"]})]
        except Exception:
            report["worker_names"] = []

    # Pièces jointes : photos + signature — rattachées au CRÉNEAU (avec la fiche).
    att_ids: list[int] = []
    for i, photo in enumerate(report.get("photos", [])):
        att_ids.append(rw.execute_kw("ir.attachment", "create", [{
            "name": f"photo_{i + 1}.jpg", "datas": _strip_data_url(photo),
            "res_model": "planning.slot", "res_id": slot_id, "mimetype": "image/jpeg",
        }]))
    if report.get("signature"):
        att_ids.append(rw.execute_kw("ir.attachment", "create", [{
            "name": "signature_client.png", "datas": _strip_data_url(report["signature"]),
            "res_model": "planning.slot", "res_id": slot_id, "mimetype": "image/png",
        }]))

    # Note récap dans l'historique du CRÉNEAU (regroupé avec la fiche d'intervention).
    rw.execute_kw("planning.slot", "message_post", [[slot_id]], {
        "body": _build_report_html(report, employee_name),
        "attachment_ids": att_ids,
    })

    # Tags posés sur la tâche / le chantier (project.tags) quand la cible le supporte.
    tags_applied = False
    if tag_ids and model in ("project.task", "project.project"):
        try:
            rw.execute_kw(model, "write", [[rid], {"tag_ids": [(4, tid) for tid in tag_ids]}])
            tags_applied = True
        except Exception:
            tags_applied = False

    # Ligne de temps (best-effort : ne bloque pas le rapport si elle échoue).
    timesheet_ok = False
    if slot.get("task_id") and report.get("hours"):
        try:
            rw.execute_kw("account.analytic.line", "create", [{
                "task_id": slot["task_id"][0],
                "project_id": slot["project_id"][0] if slot.get("project_id") else False,
                "employee_id": hr_employee_id,
                "unit_amount": float(report["hours"]),
                "name": report.get("type") or "Intervention",
            }])
            timesheet_ok = True
        except Exception:
            timesheet_ok = False

    # Prochaine action → activité planifiée (best-effort, ne bloque pas le rapport).
    activity_ok = _create_next_activity(
        rw, model, rid, report.get("next_action"), report.get("next_action_date"))

    # Fiche d'intervention native Odoo (worksheet) — best-effort.
    worksheet_ok = False
    try:
        _fill_worksheet(ro, rw, slot_id, slot, report)
        worksheet_ok = True
    except Exception:
        worksheet_ok = False

    return {"ok": True, "model": model, "res_id": rid,
            "attachments": len(att_ids), "timesheet": timesheet_ok,
            "activity": activity_ok, "tags": tags_applied, "worksheet": worksheet_ok}


# --- RH : congés, soldes, fiches de salaire -------------------------------
# Odoo 19 : le "type de congé" est un hr.work.entry.type (filtrés par
# leave_validation_type) ; les soldes via virtual_remaining_leaves (contexte
# employé). hr.leave = la demande ; net_wage sur hr.payslip.

# Libellés FR + icônes pour les types de congé (mappés sur les noms Odoo réels).
# Seuls les types listés ici sont proposés/affichés — config curée, inspirée de Tipee.
_LEAVE_LABELS = {
    "Paid Time Off": ("🌴", "Vacances"),
    "Paid Time Off (Switzerland)": ("🌴", "Vacances"),
    "Salary in case of Illness": ("🤒", "Maladie"),
    "Salary in case of Accident": ("🤕", "Accident"),
    "Salary in case of Maternity / Paternity Leave": ("👶", "Maternité / Paternité"),
    "Salary in case of Military Leave": ("🎖️", "Service militaire"),
    "Unpaid": ("💸", "Congé sans solde"),
    "Récuperation heure supp.": ("⏱️", "Récupération d'heures"),
    "Compensatory Time Off": ("🔄", "Compensation"),
    "Déménagement": ("📦", "Déménagement"),
    "Extra Time Off": ("➕", "Congé supplémentaire"),
}
_LEAVE_ORDER = list(_LEAVE_LABELS.keys())


def _friendly_leave(name: str | None) -> tuple[str, str]:
    """(icône, libellé FR) pour un type de congé ; repli sur le nom Odoo brut."""
    if name and name in _LEAVE_LABELS:
        return _LEAVE_LABELS[name]
    return ("🗓️", name or "Congé")


def _leave_types_raw(hr_employee_id: int) -> list[dict]:
    ro = get_client()
    return ro.execute_kw(
        "hr.work.entry.type", "search_read",
        [[["leave_validation_type", "!=", False]]],
        {"fields": ["name", "request_unit", "virtual_remaining_leaves"],
         "context": {"employee_id": hr_employee_id}},
    )


def leave_balances(hr_employee_id: int) -> dict:
    """Soldes : congés restants par type (avec solde) + heures supplémentaires."""
    leaves = []
    for t in _leave_types_raw(hr_employee_id):
        if t.get("virtual_remaining_leaves"):
            icon, label = _friendly_leave(t["name"])
            leaves.append({"label": label, "icon": icon,
                           "remaining": t["virtual_remaining_leaves"], "unit": t.get("request_unit")})
    leaves.sort(key=lambda x: -x["remaining"])
    emp = get_client().execute_kw("hr.employee", "read", [[hr_employee_id]], {"fields": ["total_overtime"]})
    return {"leaves": leaves, "overtime_hours": emp[0]["total_overtime"] if emp else 0.0}


def leave_types(hr_employee_id: int) -> list[dict]:
    """Types de congé proposés (liste curée : libellés FR + icônes, dédoublonnés)."""
    by_name: dict[str, dict] = {}
    for t in _leave_types_raw(hr_employee_id):
        if t["name"] not in _LEAVE_LABELS:
            continue  # on n'affiche que les types curés
        cur = by_name.get(t["name"])
        if cur is None or (t.get("virtual_remaining_leaves") or 0) > (cur.get("virtual_remaining_leaves") or 0):
            by_name[t["name"]] = t
    out = []
    for raw_name in _LEAVE_ORDER:
        t = by_name.get(raw_name)
        if not t:
            continue
        icon, label = _LEAVE_LABELS[raw_name]
        out.append({"id": t["id"], "label": label, "icon": icon,
                    "remaining": t.get("virtual_remaining_leaves") or 0.0})
    return out


def my_leaves(hr_employee_id: int) -> list[dict]:
    """Mes demandes de congé (les plus récentes), avec icône + libellé FR."""
    ro = get_client()
    leaves = ro.execute_kw(
        "hr.leave", "search_read", [[["employee_id", "=", hr_employee_id]]],
        {"fields": ["work_entry_type_id", "request_date_from", "request_date_to",
                    "number_of_days", "state", "name"],
         "order": "request_date_from desc", "limit": 20},
    )
    for l in leaves:
        name = l["work_entry_type_id"][1] if l.get("work_entry_type_id") else None
        l["icon"], l["type_label"] = _friendly_leave(name)
    return leaves


def create_leave(hr_employee_id: int, type_id: int, date_from: str, date_to: str, name: str) -> int:
    """Crée une demande de congé (hr.leave) pour l'employé (à valider par le bureau)."""
    vals = {
        "employee_id": hr_employee_id,
        "work_entry_type_id": type_id,
        "request_date_from": date_from,
        "request_date_to": date_to,
    }
    if name:
        vals["name"] = name
    return get_write_client().execute_kw("hr.leave", "create", [vals])


def my_payslips(hr_employee_id: int) -> list[dict]:
    """Mes fiches de salaire."""
    ro = get_client()
    return ro.execute_kw(
        "hr.payslip", "search_read", [[["employee_id", "=", hr_employee_id]]],
        {"fields": ["name", "date_from", "date_to", "state", "net_wage"],
         "order": "date_from desc", "limit": 24},
    )


def payslip_pdf(hr_employee_id: int, payslip_id: int) -> dict | None:
    """PDF d'une fiche de salaire (depuis la pièce jointe Odoo). None si non autorisé."""
    ro = get_client()
    owned = ro.execute_kw(
        "hr.payslip", "search_read",
        [[["id", "=", payslip_id], ["employee_id", "=", hr_employee_id]]],
        {"fields": ["name"], "limit": 1},
    )
    if not owned:
        return None
    att = ro.execute_kw(
        "ir.attachment", "search_read",
        [[["res_model", "=", "hr.payslip"], ["res_id", "=", payslip_id],
          ["mimetype", "=", "application/pdf"]]],
        {"fields": ["name", "datas"], "order": "create_date desc", "limit": 1},
    )
    if not att:
        return {"available": False}
    return {"available": True, "name": att[0]["name"], "datas": att[0]["datas"]}


# --- Semaine : planning + absences équipe -----------------------------------

def _week_bounds(offset: int = 0) -> tuple[datetime, datetime]:
    """Lundi 00:00 (local) de la semaine (offset en semaines) et lundi suivant."""
    now = datetime.now(TZ)
    monday = (now - timedelta(days=now.weekday())).replace(hour=0, minute=0, second=0, microsecond=0)
    monday += timedelta(weeks=offset)
    return monday, monday + timedelta(days=7)


def week_planning(hr_employee_id: int, offset: int = 0) -> dict:
    """Créneaux de la semaine (offset) de l'employé, avec jour local pré-calculé."""
    company_id = employee_company_id(hr_employee_id)
    monday, next_monday = _week_bounds(offset)
    start = monday.astimezone(timezone.utc).strftime(ODOO_FMT)
    end = next_monday.astimezone(timezone.utc).strftime(ODOO_FMT)
    ro = get_client()
    slots = ro.execute_kw(
        "planning.slot", "search_read",
        [[["employee_ids", "in", [hr_employee_id]],
          ["start_datetime", ">=", start], ["start_datetime", "<", end]] + _company_domain(company_id)],
        {"fields": _SLOT_FIELDS, "order": "start_datetime asc"},
    )
    for s in slots:
        s["label"] = _slot_label(s)
        s["day"] = _parse_odoo_dt(s["start_datetime"]).astimezone(TZ).date().isoformat()
    return {"week_start": monday.date().isoformat(), "slots": slots}


def upcoming_planning(hr_employee_id: int, days: int = 5) -> dict:
    """Créneaux planifiés de l'employé sur les `days` prochains jours (aujourd'hui inclus)."""
    company_id = employee_company_id(hr_employee_id)
    days = max(1, min(days, 14))
    now = datetime.now(TZ)
    start_local = now.replace(hour=0, minute=0, second=0, microsecond=0)
    end_local = start_local + timedelta(days=days)
    start = start_local.astimezone(timezone.utc).strftime(ODOO_FMT)
    end = end_local.astimezone(timezone.utc).strftime(ODOO_FMT)
    ro = get_client()
    slots = ro.execute_kw(
        "planning.slot", "search_read",
        [[["employee_ids", "in", [hr_employee_id]],
          ["start_datetime", ">=", start], ["start_datetime", "<", end]] + _company_domain(company_id)],
        {"fields": _SLOT_FIELDS, "order": "start_datetime asc"},
    )
    for s in slots:
        s["label"] = _slot_label(s)
        s["day"] = _parse_odoo_dt(s["start_datetime"]).astimezone(TZ).date().isoformat()
    return {"start": start_local.date().isoformat(), "days": days, "slots": slots}


def team_week(offset: int = 0) -> dict:
    """Grille équipe (company 5) : par employé, qui travaille / est absent chaque jour."""
    monday, next_monday = _week_bounds(offset)
    start_utc = monday.astimezone(timezone.utc).strftime(ODOO_FMT)
    end_utc = next_monday.astimezone(timezone.utc).strftime(ODOO_FMT)
    week_from = monday.date().isoformat()
    week_to = (next_monday - timedelta(days=1)).date().isoformat()
    dates = [(monday + timedelta(days=i)).date().isoformat() for i in range(7)]
    ro = get_client()

    employees = ro.execute_kw(
        "hr.employee", "search_read", [_company_domain()],
        {"fields": ["name"], "order": "name"},
    )
    members = {e["id"]: {"id": e["id"], "name": e["name"], "days": {d: {} for d in dates}}
               for e in employees}

    slots = ro.execute_kw(
        "planning.slot", "search_read",
        [[["start_datetime", ">=", start_utc], ["start_datetime", "<", end_utc]] + _company_domain()],
        {"fields": _SLOT_FIELDS + ["employee_ids"], "order": "start_datetime asc"},
    )
    for s in slots:
        dt = _parse_odoo_dt(s["start_datetime"]).astimezone(TZ)
        day = dt.date().isoformat()
        entry = {"id": s["id"], "time": dt.strftime("%H:%M"), "label": _slot_label(s)}
        for eid in s.get("employee_ids", []):
            if eid in members and day in members[eid]["days"]:
                members[eid]["days"][day].setdefault("slots", []).append(entry)
                members[eid]["days"][day]["work"] = True

    leaves = ro.execute_kw(
        "hr.leave", "search_read",
        [[["employee_company_id", "=", settings.company_id],
          ["state", "in", ["validate", "validate1"]],
          ["request_date_from", "<=", week_to], ["request_date_to", ">=", week_from]]],
        {"fields": ["employee_id", "work_entry_type_id", "request_date_from", "request_date_to"]},
    )
    for lv in leaves:
        eid = lv["employee_id"][0] if lv.get("employee_id") else None
        if eid not in members:
            continue
        icon, _ = _friendly_leave(lv["work_entry_type_id"][1] if lv.get("work_entry_type_id") else None)
        for d in dates:
            if lv["request_date_from"] <= d <= lv["request_date_to"]:
                members[eid]["days"][d]["leave"] = icon

    return {"week_start": week_from, "dates": dates, "members": list(members.values())}


def upcoming_holidays(limit: int = 6) -> list[dict]:
    """Prochains jours fériés (canton FR) de Swiss Piscine, depuis aujourd'hui.
    Stockés dans resource.calendar.leaves (resource_id=False, préfixe « Férié FR — »)."""
    ro = get_client()
    cutoff = datetime.now(TZ).date().isoformat() + " 00:00:00"
    rows = ro.execute_kw(
        "resource.calendar.leaves", "search_read",
        [[["company_id", "=", settings.company_id], ["resource_id", "=", False],
          ["name", "like", "Férié FR"], ["date_from", ">=", cutoff]]],
        {"fields": ["name", "date_from"], "order": "date_from asc", "limit": limit},
    )
    out = []
    for r in rows:
        name = r["name"]
        for pref in ("Férié FR — ", "Férié FR - ", "Férié FR —", "Férié FR -", "Férié FR"):
            if name.startswith(pref):
                name = name[len(pref):].strip(" —-")
                break
        out.append({"date": r["date_from"][:10], "name": name})
    return out


def employee_extra(hr_employee_id: int) -> dict:
    """Données de profil enrichies : avatar, taux d'activité, parcours (CV)."""
    ro = get_client()
    rows = ro.execute_kw("hr.employee", "read", [[hr_employee_id]],
                         {"fields": ["image_256", "resource_calendar_id"]})
    if not rows:
        return {}
    e = rows[0]
    rate = None
    if e.get("resource_calendar_id"):
        cal = ro.execute_kw("resource.calendar", "read", [[e["resource_calendar_id"][0]]],
                            {"fields": ["hours_per_week", "full_time_required_hours"]})
        ft = cal[0].get("full_time_required_hours") if cal else None
        if ft:
            rate = round(cal[0]["hours_per_week"] / ft * 100)
    resume = ro.execute_kw(
        "hr.resume.line", "search_read", [[["employee_id", "=", hr_employee_id]]],
        {"fields": ["name", "description", "date_start", "line_type_id"],
         "order": "date_start desc", "limit": 10},
    )
    return {"avatar": e.get("image_256") or None, "activity_rate": rate, "resume": resume}


# --- Manager : validation des congés ---------------------------------------

def employee_manager_hr_id(hr_employee_id: int) -> int | None:
    """Supérieur direct (parent_id) de l'employé, ou None."""
    rows = get_client().execute_kw("hr.employee", "read", [[hr_employee_id]], {"fields": ["parent_id"]})
    if rows and rows[0].get("parent_id"):
        return rows[0]["parent_id"][0]
    return None


def leave_belongs_to_manager(leave_id: int, manager_hr_id: int) -> bool:
    """Vrai si la demande appartient à un membre de l'équipe du manager (parent_id)."""
    n = get_client().execute_kw(
        "hr.leave", "search_count",
        [[["id", "=", leave_id], ["employee_id.parent_id", "=", manager_hr_id]]])
    return n > 0


def pending_leaves(manager_hr_id: int | None = None) -> list[dict]:
    """Demandes en attente (company 5). Si manager_hr_id : seulement son équipe
    (employés dont le supérieur = manager). Sinon (admin) : toutes."""
    ro = get_client()
    domain = [["employee_company_id", "=", settings.company_id], ["state", "in", ["confirm", "validate1"]]]
    if manager_hr_id:
        domain.append(["employee_id.parent_id", "=", manager_hr_id])
    leaves = ro.execute_kw(
        "hr.leave", "search_read", [domain],
        {"fields": ["employee_id", "work_entry_type_id", "request_date_from",
                    "request_date_to", "number_of_days", "name", "state"],
         "order": "request_date_from asc"},
    )
    for l in leaves:
        name = l["work_entry_type_id"][1] if l.get("work_entry_type_id") else None
        l["icon"], l["type_label"] = _friendly_leave(name)
        l["who"] = l["employee_id"][1] if l.get("employee_id") else "—"
    return leaves


def approve_leave(leave_id: int) -> None:
    """Valide entièrement la demande, quel que soit le type de validation.
    Types « both » : confirm → validate1 (action_approve) → validate (action_validate).
    Types « manager »/« hr » : confirm → validate en une étape."""
    rw = get_write_client()
    ro = get_client()

    def state():
        return ro.execute_kw("hr.leave", "read", [[leave_id]], {"fields": ["state"]})[0]["state"]

    if state() == "confirm":
        rw.execute_kw("hr.leave", "action_approve", [[leave_id]])
    if state() == "validate1":
        rw.execute_kw("hr.leave", "action_validate", [[leave_id]])


def refuse_leave(leave_id: int) -> None:
    get_write_client().execute_kw("hr.leave", "action_refuse", [[leave_id]])


# --- Admin : vue d'ensemble équipe ------------------------------------------

def admin_employees_hours() -> list[dict]:
    """Par employé (société courante, actifs) : heures réalisées jour / semaine / mois / année."""
    ro = get_client()
    emps = ro.execute_kw(
        "hr.employee", "search_read", [_company_domain() + [["active", "=", True]]],
        {"fields": ["name"], "order": "name"},
    )
    ids = [e["id"] for e in emps]
    if not ids:
        return []
    now = datetime.now(TZ)
    year_start = datetime(now.year, 1, 1, tzinfo=TZ)
    atts = ro.execute_kw(
        "hr.attendance", "search_read",
        [[["employee_id", "in", ids],
          ["check_in", ">=", year_start.astimezone(timezone.utc).strftime(ODOO_FMT)],
          ["check_in", "<", now.astimezone(timezone.utc).strftime(ODOO_FMT)]]],
        {"fields": ["employee_id", "check_in", "worked_hours"]},
    )
    today = now.date()
    monday = today - timedelta(days=today.weekday())
    agg = {i: {"day": 0.0, "week": 0.0, "month": 0.0, "year": 0.0} for i in ids}
    for a in atts:
        eid = a["employee_id"][0] if a.get("employee_id") else None
        ag = agg.get(eid)
        if not ag:
            continue
        d = _parse_odoo_dt(a["check_in"]).astimezone(TZ).date()
        wh = a.get("worked_hours") or 0.0
        ag["year"] += wh
        if d.year == today.year and d.month == today.month:
            ag["month"] += wh
        if d >= monday:
            ag["week"] += wh
        if d == today:
            ag["day"] += wh
    return [{"id": e["id"], "name": e["name"], **{k: round(v, 1) for k, v in agg[e["id"]].items()}} for e in emps]


def admin_leaves() -> list[dict]:
    """Toutes les demandes de congé (société courante) : en attente + validées, pour liste/calendrier."""
    ro = get_client()
    leaves = ro.execute_kw(
        "hr.leave", "search_read",
        [[["employee_company_id", "=", settings.company_id], ["state", "in", ["confirm", "validate1", "validate", "refuse"]]]],
        {"fields": ["employee_id", "work_entry_type_id", "request_date_from",
                    "request_date_to", "number_of_days", "state"],
         "order": "request_date_from desc"},
    )
    for l in leaves:
        name = l["work_entry_type_id"][1] if l.get("work_entry_type_id") else None
        l["icon"], l["type_label"] = _friendly_leave(name)
        l["who"] = l["employee_id"][1] if l.get("employee_id") else "—"
    return leaves


# --- Documents (module Documents Odoo, dossier par employé) -----------------
# hr.employee.hr_employee_folder_id pointe le dossier racine. Sous-dossiers
# cohérents : « 1. Renseignements », « 2. Contrat », « 2. Certificats de salaire »,
# « 1. Maladie ». On résout par mots-clés sous l'arbre de l'employé (cloisonné).

def _employee_folder_tree(hr_employee_id: int):
    """(root_id, folders) — tous les sous-dossiers de l'employé (id, name, parent)."""
    ro = get_client()
    emp = ro.execute_kw("hr.employee", "read", [[hr_employee_id]], {"fields": ["hr_employee_folder_id"]})
    if not emp or not emp[0].get("hr_employee_folder_id"):
        return None, []
    root = emp[0]["hr_employee_folder_id"][0]
    folders = [{"id": root, "name": emp[0]["hr_employee_folder_id"][1], "parent": None}]
    frontier = [root]
    for _ in range(6):
        kids = ro.execute_kw(
            "documents.document", "search_read",
            [[["type", "=", "folder"], ["folder_id", "in", frontier]]],
            {"fields": ["name", "folder_id"]},
        )
        if not kids:
            break
        folders += [{"id": k["id"], "name": k["name"], "parent": k["folder_id"][0]} for k in kids]
        frontier = [k["id"] for k in kids]
    return root, folders


def _category_folder(folders, *keywords):
    for f in folders:
        n = f["name"].lower()
        if any(k in n for k in keywords):
            return f["id"]
    return None


def _descendants(folders, folder_id):
    ids = {folder_id}
    changed = True
    while changed:
        changed = False
        for f in folders:
            if f["parent"] in ids and f["id"] not in ids:
                ids.add(f["id"]); changed = True
    return list(ids)


def _docs_under(folder_ids):
    if not folder_ids:
        return []
    ro = get_client()
    docs = ro.execute_kw(
        "documents.document", "search_read",
        [[["type", "=", "binary"], ["folder_id", "in", folder_ids]]],
        {"fields": ["name", "mimetype", "create_date"], "order": "create_date desc"},
    )
    return [{"id": d["id"], "name": d["name"], "mimetype": d.get("mimetype") or "",
             "date": (d.get("create_date") or "")[:10]} for d in docs]


def employee_documents(hr_employee_id: int) -> dict:
    """Documents de l'employé par catégorie (Documents Odoo)."""
    root, folders = _employee_folder_tree(hr_employee_id)
    empty = {"personal": [], "contract": [], "salary_certificates": [], "medical": []}
    if root is None:
        return empty

    def cat(*kw):
        cf = _category_folder(folders, *kw)
        return _docs_under(_descendants(folders, cf)) if cf else []

    return {
        "personal": cat("renseignement"),
        "contract": cat("contrat"),
        "salary_certificates": cat("certificat de salaire", "certificats de salaire"),
        "medical": cat("maladie"),
    }


def document_file(hr_employee_id: int, doc_id: int) -> dict | None:
    """Fichier (base64) d'un document, restreint à l'arbre de dossiers de l'employé."""
    root, folders = _employee_folder_tree(hr_employee_id)
    if root is None:
        return None
    folder_ids = {f["id"] for f in folders}
    ro = get_client()
    rows = ro.execute_kw("documents.document", "read", [[doc_id]],
                         {"fields": ["name", "datas", "mimetype", "folder_id", "type"]})
    if not rows:
        return None
    d = rows[0]
    if d.get("type") != "binary" or not d.get("folder_id") or d["folder_id"][0] not in folder_ids:
        return None
    return {"available": bool(d.get("datas")), "name": d["name"],
            "datas": d.get("datas"), "mimetype": d.get("mimetype") or "application/octet-stream"}


# --- Fiche employé : champs personnels modifiables par l'employé -------------
EMPLOYEE_EDITABLE = {
    "private_street", "private_street2", "private_zip", "private_city",
    "private_phone", "private_email", "work_phone",
    "emergency_contact", "emergency_phone", "place_of_birth",
    "permit_no", "visa_no", "passport_id", "identification_id",
    "spouse_complete_name", "study_field", "study_school",
    "birthday", "work_permit_expiration_date", "visa_expire", "spouse_birthdate",
    "children", "marital", "certificate", "lang",
    "private_country_id", "country_id", "country_of_birth",
}
_EMP_M2O = {"private_country_id", "country_id", "country_of_birth"}
_EMP_INT = {"children"}


def employee_details(hr_employee_id: int) -> dict:
    """Champs personnels de l'employé (valeurs actuelles + présence d'un scan de permis)."""
    ro = get_client()
    rows = ro.execute_kw("hr.employee", "read", [[hr_employee_id]],
                         {"fields": list(EMPLOYEE_EDITABLE) + ["has_work_permit"]})
    if not rows:
        return {}
    e = rows[0]
    out = {}
    for k in EMPLOYEE_EDITABLE:
        v = e.get(k)
        if k in _EMP_M2O:
            out[k] = {"id": v[0], "name": v[1]} if v else None
        else:
            out[k] = v if v not in (False,) else None
    out["has_permit_scan"] = bool(e.get("has_work_permit"))
    return out


def update_employee_details(hr_employee_id: int, data: dict) -> dict:
    """Écrit les champs autorisés sur la fiche de l'employé (sa propre fiche)."""
    vals = {}
    for k, v in (data or {}).items():
        if k not in EMPLOYEE_EDITABLE:
            continue
        if k in _EMP_M2O:
            vals[k] = int(v) if v else False
        elif k in _EMP_INT:
            try:
                vals[k] = int(v) if v not in (None, "", False) else 0
            except (TypeError, ValueError):
                vals[k] = 0
        else:
            vals[k] = v if v not in (None, "") else False
    if vals:
        get_write_client().execute_kw("hr.employee", "write", [[hr_employee_id], vals])
    return {"updated": list(vals.keys())}


def upload_permit_scan(hr_employee_id: int, datas_b64: str) -> dict:
    """Dépose le scan du permis de séjour sur la fiche employé (champ has_work_permit)."""
    get_write_client().execute_kw(
        "hr.employee", "write", [[hr_employee_id], {"has_work_permit": _strip_data_url(datas_b64)}])
    return {"ok": True}


def list_countries() -> list[dict]:
    ro = get_client()
    return ro.execute_kw("res.country", "search_read", [[]], {"fields": ["name"], "order": "name"})


# --- Notifications (poll Odoo) & PIN ---------------------------------------

def set_employee_pin(hr_employee_id: int, pin: str) -> dict:
    """Écrit le PIN dans hr.employee.pin (Odoo = référence du code, kiosque/app)."""
    get_write_client().execute_kw("hr.employee", "write", [[hr_employee_id], {"pin": pin}])
    return {"ok": True}


def poll_events(hr_employee_id: int, since_utc: str) -> list[dict]:
    """Événements Odoo depuis `since_utc` (UTC 'YYYY-MM-DD HH:MM:SS') : congés
    validés/refusés + planning créé/modifié pour l'employé. Lecture seule."""
    company_id = employee_company_id(hr_employee_id)
    ro = get_client()
    events = []

    leaves = ro.execute_kw(
        "hr.leave", "search_read",
        [[["employee_id", "=", hr_employee_id], ["state", "in", ["validate", "refuse"]],
          ["write_date", ">", since_utc]]],
        {"fields": ["id", "state", "write_date", "work_entry_type_id",
                    "request_date_from", "request_date_to"]},
    )
    for l in leaves:
        approved = l["state"] == "validate"
        _, label = _friendly_leave(l["work_entry_type_id"][1] if l.get("work_entry_type_id") else None)
        events.append({
            "type": "leave_approved" if approved else "leave_refused",
            "cat": "leave",
            "title": "Congé validé" if approved else "Congé refusé",
            "body": f"{label} · {l['request_date_from']} → {l['request_date_to']}",
            "dedup_key": f"leave-{l['id']}-{l['state']}-{l['write_date']}",
            "occurred_at": l["write_date"],
        })

    slots = ro.execute_kw(
        "planning.slot", "search_read",
        [[["employee_ids", "in", [hr_employee_id]], ["write_date", ">", since_utc]] + _company_domain(company_id)],
        {"fields": _SLOT_FIELDS + ["write_date", "create_date"]},
    )
    for s in slots:
        is_new = s.get("create_date") == s.get("write_date")
        when = ""
        if s.get("start_datetime"):
            when = _parse_odoo_dt(s["start_datetime"]).astimezone(TZ).strftime("%d.%m à %H:%M")
        events.append({
            "type": "planning_new" if is_new else "planning_updated",
            "cat": "planning",
            "title": "Nouvelle intervention" if is_new else "Planning mis à jour",
            "body": f"{_slot_label(s)}{' · ' + when if when else ''}",
            "dedup_key": f"slot-{s['id']}-{s['write_date']}",
            "occurred_at": s["write_date"],
        })
    return events


# --- Notes de frais (hr.expense) -------------------------------------------
# Catégories = product.product can_be_expensed ; TVA = account.tax achat (CH 2024+).
# Montant saisi = TTC (Odoo recalcule HT + TVA). Créé en brouillon, mode « à rembourser ».
EXPENSE_CCY = 4  # CHF
EXPENSE_CATEGORIES = [
    {"id": 2536, "name": "Matériel"},
    {"id": 9, "name": "Repas"},
    {"id": 10, "name": "Déplacement / logement"},
    {"id": 11, "name": "Kilomètres"},
    {"id": 13, "name": "Communication"},
    {"id": 12, "name": "Cadeaux"},
]
EXPENSE_TAXES = [
    {"id": 153, "name": "TVA 8.1 %", "rate": 8.1},
    {"id": 147, "name": "TVA 2.6 %", "rate": 2.6},
    {"id": 150, "name": "TVA 3.8 %", "rate": 3.8},
    {"id": 138, "name": "Sans TVA", "rate": 0.0},
]
_EXPENSE_STATE_FR = {
    "draft": "Brouillon", "reported": "Soumise", "submitted": "Soumise",
    "approved": "Approuvée", "posted": "Comptabilisée", "done": "Payée",
    "in_payment": "En paiement", "paid": "Payée", "refused": "Refusée",
}


def expense_options() -> dict:
    return {"categories": EXPENSE_CATEGORIES, "taxes": EXPENSE_TAXES}


def create_expense(hr_employee_id: int, name: str, amount: float, category_id: int | None,
                   tax_id: int | None, date: str | None, description: str | None,
                   photos: list[str] | None = None) -> dict:
    """Crée une note de frais (hr.expense) en BROUILLON pour l'employé. Montant = TTC."""
    company_id = employee_company_id(hr_employee_id)
    rw = get_write_client()
    vals = {
        "employee_id": hr_employee_id,
        "company_id": company_id,
        "currency_id": EXPENSE_CCY,
        "name": (name or "").strip() or "Note de frais",
        "price_unit": float(amount),
        "quantity": 1.0,
        "payment_mode": "own_account",
    }
    if category_id:
        vals["product_id"] = int(category_id)
    if tax_id:
        vals["tax_ids"] = [(6, 0, [int(tax_id)])]
    if date:
        vals["date"] = date
    if description:
        vals["description"] = description
    exp_id = rw.execute_kw("hr.expense", "create", [vals])

    main_att = None
    for i, photo in enumerate(photos or []):
        aid = rw.execute_kw("ir.attachment", "create", [{
            "name": f"recu_{i + 1}.jpg", "datas": _strip_data_url(photo),
            "res_model": "hr.expense", "res_id": exp_id, "mimetype": "image/jpeg",
        }])
        if main_att is None:
            main_att = aid
    if main_att:
        try:
            rw.execute_kw("hr.expense", "write", [[exp_id], {"message_main_attachment_id": main_att}])
        except Exception:
            pass
    return {"id": exp_id}


def my_expenses(hr_employee_id: int, limit: int = 40) -> list[dict]:
    ro = get_client()
    rows = ro.execute_kw(
        "hr.expense", "search_read", [[["employee_id", "=", hr_employee_id]]],
        {"fields": ["name", "date", "total_amount_currency", "tax_amount_currency",
                    "product_id", "state"], "order": "date desc, id desc", "limit": limit},
    )
    for r in rows:
        r["state_label"] = _EXPENSE_STATE_FR.get(r.get("state"), r.get("state") or "")
        r["category"] = r["product_id"][1] if r.get("product_id") else ""
        r["amount"] = r.get("total_amount_currency") or 0.0
    return rows


def upload_medical_document(hr_employee_id: int, filename: str, datas_b64: str, mimetype: str) -> dict | None:
    """Dépose un certificat médical dans le dossier « Maladie » de l'employé."""
    root, folders = _employee_folder_tree(hr_employee_id)
    if root is None:
        return None
    cf = _category_folder(folders, "maladie")
    if not cf:
        return None
    rw = get_write_client()
    doc_id = rw.execute_kw("documents.document", "create", [{
        "type": "binary", "name": filename, "folder_id": cf,
        "datas": _strip_data_url(datas_b64), "mimetype": mimetype or "application/octet-stream",
    }])
    return {"id": doc_id}


def send_email(to: str, subject: str, body_html: str) -> bool:
    """Envoie un email transactionnel via Odoo (mail.mail). Best-effort."""
    try:
        rw = get_write_client()
        mail_id = rw.execute_kw("mail.mail", "create", [{
            "subject": subject,
            "body_html": body_html,
            "email_to": to,
            "auto_delete": True,
        }])
        rw.execute_kw("mail.mail", "send", [[mail_id]])
        return True
    except Exception:
        return False
