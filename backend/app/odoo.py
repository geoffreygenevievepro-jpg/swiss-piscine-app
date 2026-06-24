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


def _company_domain() -> list:
    return [["company_id", "=", settings.company_id]]


# --- Employés --------------------------------------------------------------

def get_employee(hr_employee_id: int) -> dict | None:
    client = get_client()
    domain = [["id", "=", hr_employee_id]] + _company_domain()
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
    start, end = _day_bounds_utc(date_iso)
    domain = [
        ["employee_ids", "in", [hr_employee_id]],
        ["start_datetime", ">=", start],
        ["start_datetime", "<", end],
    ] + _company_domain()
    slots = client.execute_kw(
        "planning.slot", "search_read", [domain],
        {"fields": _SLOT_FIELDS, "order": "start_datetime asc"},
    )
    for s in slots:
        s["label"] = _slot_label(s)
    return {"interventions": slots}


def intervention_detail(slot_id: int, hr_employee_id: int) -> dict | None:
    """Détail d'un créneau + infos client. Restreint aux créneaux de l'employé."""
    client = get_client()
    domain = [["id", "=", slot_id], ["employee_ids", "in", [hr_employee_id]]] + _company_domain()
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
        slot["history"] = client_history(pid)
    return slot


def create_intervention(hr_employee_id: int, name: str, start_utc: str, end_utc: str,
                        partner_id: int | None = None, type_label: str | None = None,
                        photos: list[str] | None = None) -> int:
    """Crée un créneau planning.slot (company 5, rôle Technicien), + photos optionnelles."""
    label = f"{type_label} — {name}" if (type_label and name) else (type_label or name)
    vals = {
        "employee_ids": [(6, 0, [hr_employee_id])],
        "start_datetime": start_utc,
        "end_datetime": end_utc,
        "company_id": settings.company_id,
        "role_id": ROLE_TECHNICIEN_ID,
    }
    if label:
        vals["name"] = label
    if partner_id:
        vals["partner_id"] = partner_id
    rw = get_write_client()
    slot_id = rw.execute_kw("planning.slot", "create", [vals])
    for i, photo in enumerate(photos or []):
        rw.execute_kw("ir.attachment", "create", [{
            "name": f"photo_{i + 1}.jpg", "datas": _strip_data_url(photo),
            "res_model": "planning.slot", "res_id": slot_id, "mimetype": "image/jpeg",
        }])
    return slot_id


def search_partners(query: str, limit: int = 15) -> list[dict]:
    """Recherche de clients (res.partner) par nom ou ville, pour le formulaire."""
    client = get_client()
    domain = ["|", ["name", "ilike", query], ["city", "ilike", query]]
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


def client_history(partner_id: int, limit: int = 3) -> list[dict]:
    """Les dernières tâches Odoo du client (project.task) : date, libellé, étape."""
    ro = get_client()
    tasks = ro.execute_kw(
        "project.task", "search_read",
        [[["partner_id", "=", partner_id]] + _company_domain()],
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
    domain = [["employee_ids", "in", [hr_employee_id]],
              ["start_datetime", "<", end_utc],
              ["end_datetime", ">", start_utc]] + _company_domain()
    if exclude_id:
        domain.append(["id", "!=", exclude_id])
    rows = ro.execute_kw(
        "planning.slot", "search_read", [domain],
        {"fields": ["start_datetime", "end_datetime", "name"], "order": "start_datetime", "limit": 1},
    )
    return rows[0] if rows else None


# --- Rapport d'intervention -----------------------------------------------

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
        ("Horaire", report.get("schedule")),
        ("Durée", f'{report["hours"]:.2f} h' if report.get("hours") else None),
        ("Matériel utilisé", report.get("materials")),
        ("Pièces utilisées", ", ".join(parts) if parts else None),
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
        rows = ro.execute_kw("ir.model", "search_read", [[["model", "=", model]]],
                             {"fields": ["id"], "limit": 1})
        _model_id_cache[model] = rows[0]["id"] if rows else None
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
        {"fields": ["name", "default_code"], "limit": limit, "order": "name"},
    )


def submit_report(hr_employee_id: int, employee_name: str, slot_id: int, report: dict) -> dict | None:
    """Enregistre le rapport dans Odoo : note chatter + photos/signature + temps.

    Restreint au créneau assigné à l'employé. Renvoie None si non autorisé.
    """
    ro = get_client()
    rows = ro.execute_kw(
        "planning.slot", "search_read",
        [[["id", "=", slot_id], ["employee_ids", "in", [hr_employee_id]]] + _company_domain()],
        {"fields": ["task_id", "project_id", "partner_id", "name"], "limit": 1},
    )
    if not rows:
        return None
    slot = rows[0]
    model, rid = _slot_target(slot, slot_id)
    rw = get_write_client()

    # Pièces jointes : photos + signature.
    att_ids: list[int] = []
    for i, photo in enumerate(report.get("photos", [])):
        att_ids.append(rw.execute_kw("ir.attachment", "create", [{
            "name": f"photo_{i + 1}.jpg", "datas": _strip_data_url(photo),
            "res_model": model, "res_id": rid, "mimetype": "image/jpeg",
        }]))
    if report.get("signature"):
        att_ids.append(rw.execute_kw("ir.attachment", "create", [{
            "name": "signature_client.png", "datas": _strip_data_url(report["signature"]),
            "res_model": model, "res_id": rid, "mimetype": "image/png",
        }]))

    # Note dans le chatter du chantier.
    rw.execute_kw(model, "message_post", [[rid]], {
        "body": _build_report_html(report, employee_name),
        "attachment_ids": att_ids,
    })

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

    return {"ok": True, "model": model, "res_id": rid,
            "attachments": len(att_ids), "timesheet": timesheet_ok, "activity": activity_ok}


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
    monday, next_monday = _week_bounds(offset)
    start = monday.astimezone(timezone.utc).strftime(ODOO_FMT)
    end = next_monday.astimezone(timezone.utc).strftime(ODOO_FMT)
    ro = get_client()
    slots = ro.execute_kw(
        "planning.slot", "search_read",
        [[["employee_ids", "in", [hr_employee_id]],
          ["start_datetime", ">=", start], ["start_datetime", "<", end]] + _company_domain()],
        {"fields": _SLOT_FIELDS, "order": "start_datetime asc"},
    )
    for s in slots:
        s["label"] = _slot_label(s)
        s["day"] = _parse_odoo_dt(s["start_datetime"]).astimezone(TZ).date().isoformat()
    return {"week_start": monday.date().isoformat(), "slots": slots}


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
        {"fields": ["employee_ids", "start_datetime"]},
    )
    for s in slots:
        day = _parse_odoo_dt(s["start_datetime"]).astimezone(TZ).date().isoformat()
        for eid in s.get("employee_ids", []):
            if eid in members and day in members[eid]["days"]:
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

def pending_leaves() -> list[dict]:
    """Demandes de congé en attente de validation (équipe company 5)."""
    ro = get_client()
    leaves = ro.execute_kw(
        "hr.leave", "search_read",
        [[["employee_company_id", "=", settings.company_id], ["state", "in", ["confirm", "validate1"]]]],
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
    get_write_client().execute_kw("hr.leave", "action_approve", [[leave_id]])


def refuse_leave(leave_id: int) -> None:
    get_write_client().execute_kw("hr.leave", "action_refuse", [[leave_id]])
