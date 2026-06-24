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
    for e in entries:
        ci = _parse_odoo_dt(e["check_in"])
        if e["check_out"]:
            today_seconds += (_parse_odoo_dt(e["check_out"]) - ci).total_seconds()
        else:
            today_seconds += (now - ci).total_seconds()
            open_since = ci.isoformat()
    return {
        "state": "in" if open_since else "out",
        "open_since": open_since,
        "today_seconds": int(today_seconds),
        "count": len(entries),
    }


def check_in(hr_employee_id: int) -> dict:
    """Pointe l'entrée. Idempotent : si déjà entré, renvoie l'état courant."""
    if _open_attendance(hr_employee_id):
        return attendance_status(hr_employee_id)
    get_write_client().execute_kw(
        "hr.attendance", "create",
        [{"employee_id": hr_employee_id, "check_in": _odoo_now()}],
    )
    return attendance_status(hr_employee_id)


def check_out(hr_employee_id: int) -> dict:
    """Pointe la sortie de la session ouverte. Idempotent si déjà sorti."""
    open_att = _open_attendance(hr_employee_id)
    if open_att:
        get_write_client().execute_kw(
            "hr.attendance", "write", [[open_att["id"]], {"check_out": _odoo_now()}],
        )
    return attendance_status(hr_employee_id)


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


def today_interventions(hr_employee_id: int) -> dict:
    """Créneaux planifiés DU JOUR pour l'employé (planning.slot, company 5)."""
    client = get_client()
    start, end = _today_bounds_utc()
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
    if slot.get("partner_id"):
        prows = client.execute_kw(
            "res.partner", "read", [[slot["partner_id"][0]]], {"fields": _PARTNER_FIELDS},
        )
        slot["partner"] = prows[0] if prows else None
    return slot


def create_intervention(hr_employee_id: int, name: str, start_utc: str,
                        end_utc: str, partner_id: int | None = None) -> int:
    """Crée un créneau planning.slot assigné à l'employé (company 5, rôle Technicien)."""
    vals = {
        "employee_ids": [(6, 0, [hr_employee_id])],
        "start_datetime": start_utc,
        "end_datetime": end_utc,
        "company_id": settings.company_id,
        "role_id": ROLE_TECHNICIEN_ID,
    }
    if name:
        vals["name"] = name
    if partner_id:
        vals["partner_id"] = partner_id
    return get_write_client().execute_kw("planning.slot", "create", [vals])


def search_partners(query: str, limit: int = 15) -> list[dict]:
    """Recherche de clients (res.partner) par nom ou ville, pour le formulaire."""
    client = get_client()
    domain = ["|", ["name", "ilike", query], ["city", "ilike", query]]
    return client.execute_kw(
        "res.partner", "search_read", [domain],
        {"fields": ["name", "city", "street", "zip"], "limit": limit, "order": "name"},
    )


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


def _build_report_html(report: dict, employee_name: str) -> str:
    rows = [
        ("Type d'intervention", report.get("type")),
        ("Technicien", employee_name),
        ("Horaire", report.get("schedule")),
        ("Durée", f'{report["hours"]:.2f} h' if report.get("hours") else None),
        ("Matériel utilisé", report.get("materials")),
    ]
    html = ["<p><strong>📋 Rapport d'intervention</strong></p><ul>"]
    for label, val in rows:
        if val:
            html.append(f"<li><strong>{_esc(label)} :</strong> {_esc(val)}</li>")
    html.append("</ul>")
    if report.get("notes"):
        html.append(f"<p><strong>Notes :</strong><br>{_esc(report['notes'])}</p>")
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

    return {"ok": True, "model": model, "res_id": rid,
            "attachments": len(att_ids), "timesheet": timesheet_ok}


# --- RH : congés, soldes, fiches de salaire -------------------------------
# Odoo 19 : le "type de congé" est un hr.work.entry.type (filtrés par
# leave_validation_type) ; les soldes via virtual_remaining_leaves (contexte
# employé). hr.leave = la demande ; net_wage sur hr.payslip.

def leave_balances(hr_employee_id: int) -> dict:
    """Soldes : congés restants par type (avec solde) + heures supplémentaires."""
    ro = get_client()
    types = ro.execute_kw(
        "hr.work.entry.type", "search_read",
        [[["leave_validation_type", "!=", False]]],
        {"fields": ["name", "virtual_remaining_leaves", "request_unit"],
         "context": {"employee_id": hr_employee_id}},
    )
    leaves = [
        {"name": t["name"], "remaining": t.get("virtual_remaining_leaves") or 0.0,
         "unit": t.get("request_unit")}
        for t in types if t.get("virtual_remaining_leaves")
    ]
    leaves.sort(key=lambda x: -x["remaining"])
    emp = ro.execute_kw("hr.employee", "read", [[hr_employee_id]], {"fields": ["total_overtime"]})
    return {"leaves": leaves, "overtime_hours": emp[0]["total_overtime"] if emp else 0.0}


def leave_types(hr_employee_id: int) -> list[dict]:
    """Types de congé sélectionnables pour une demande (reflète la config Odoo)."""
    ro = get_client()
    types = ro.execute_kw(
        "hr.work.entry.type", "search_read",
        [[["leave_validation_type", "!=", False]]],
        {"fields": ["name", "request_unit", "virtual_remaining_leaves"],
         "context": {"employee_id": hr_employee_id}},
    )
    # Dédoublonnage par nom (la config Odoo a des types en double) + solde d'abord.
    by_name: dict[str, dict] = {}
    for t in types:
        if t["name"] not in by_name or (t.get("virtual_remaining_leaves") or 0) > (by_name[t["name"]].get("virtual_remaining_leaves") or 0):
            by_name[t["name"]] = t
    uniq = sorted(by_name.values(),
                  key=lambda t: (-(t.get("virtual_remaining_leaves") or 0.0), t["name"]))
    return [{"id": t["id"], "name": t["name"], "remaining": t.get("virtual_remaining_leaves") or 0.0}
            for t in uniq]


def my_leaves(hr_employee_id: int) -> list[dict]:
    """Mes demandes de congé (les plus récentes)."""
    ro = get_client()
    return ro.execute_kw(
        "hr.leave", "search_read", [[["employee_id", "=", hr_employee_id]]],
        {"fields": ["work_entry_type_id", "request_date_from", "request_date_to",
                    "number_of_days", "state", "name"],
         "order": "request_date_from desc", "limit": 20},
    )


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
