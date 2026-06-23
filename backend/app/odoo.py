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


# --- Interventions (project.task) -----------------------------------------

_TASK_FIELDS = ["name", "partner_id", "date_deadline", "stage_id", "project_id", "priority", "state"]
# États considérés comme "clos" : exclus de « Ma journée ».
_CLOSED_STATES = ["1_done", "1_canceled"]


def today_tasks(hr_employee_id: int) -> dict:
    """Interventions ouvertes assignées à l'employé (project.task), company 5."""
    user_id = _employee_user_id(hr_employee_id)
    if not user_id:
        return {"user_linked": False, "tasks": []}
    client = get_client()
    domain = [
        ["user_ids", "in", [user_id]],
        ["state", "not in", _CLOSED_STATES],
    ] + _company_domain()
    tasks = client.execute_kw(
        "project.task", "search_read", [domain],
        {"fields": _TASK_FIELDS, "order": "date_deadline asc, priority desc", "limit": 60},
    )
    return {"user_linked": True, "tasks": tasks}


def task_detail(task_id: int, hr_employee_id: int) -> dict | None:
    """Détail d'une intervention + infos client. Restreint aux tâches assignées à l'employé."""
    user_id = _employee_user_id(hr_employee_id)
    if not user_id:
        return None
    client = get_client()
    domain = [["id", "=", task_id], ["user_ids", "in", [user_id]]] + _company_domain()
    rows = client.execute_kw(
        "project.task", "search_read", [domain],
        {"fields": _TASK_FIELDS + ["description", "planned_date_begin"], "limit": 1},
    )
    if not rows:
        return None
    task = rows[0]
    partner = None
    if task.get("partner_id"):
        prows = client.execute_kw(
            "res.partner", "read", [[task["partner_id"][0]]],
            {"fields": ["name", "street", "street2", "zip", "city", "phone", "mobile", "email"]},
        )
        partner = prows[0] if prows else None
    task["partner"] = partner
    return task
