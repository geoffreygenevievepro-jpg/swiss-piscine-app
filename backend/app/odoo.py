"""Pont vers Odoo : réutilise odoo_client.py (vendoré dans backend/), company_id=5.

En Sprint 0 l'API ne fait que des LECTURES Odoo (profil employé). Le client est
instancié en lecture seule par sécurité ; les écritures (pointage, rapports)
seront activées explicitement dans les sprints suivants.
"""
import sys
import threading

from dotenv import load_dotenv

from .config import BACKEND_DIR, settings

# Credentials Odoo depuis le .env du backend ; odoo_client.py est vendoré dans backend/.
load_dotenv(BACKEND_DIR / ".env")
sys.path.insert(0, str(BACKEND_DIR))

from odoo_client import OdooClient  # noqa: E402

_client: OdooClient | None = None
_lock = threading.Lock()


def get_client(readonly: bool = True) -> OdooClient:
    """Renvoie un client Odoo authentifié (singleton thread-safe)."""
    global _client
    with _lock:
        if _client is None:
            client = OdooClient(readonly=readonly)
            client.authenticate()
            _client = client
        return _client


def _company_domain() -> list:
    return [["company_id", "=", settings.company_id]]


def get_employee(hr_employee_id: int) -> dict | None:
    """Lit le profil d'un employé Swiss Piscine (company_id=5 forcé)."""
    client = get_client()
    domain = [["id", "=", hr_employee_id]] + _company_domain()
    rows = client.execute_kw(
        "hr.employee", "search_read",
        [domain],
        {
            "fields": ["name", "job_title", "work_email", "work_phone",
                       "mobile_phone", "department_id"],
            "limit": 1,
        },
    )
    return rows[0] if rows else None


def list_employees() -> list[dict]:
    """Liste les employés Swiss Piscine (pour le seed des comptes)."""
    client = get_client()
    return client.execute_kw(
        "hr.employee", "search_read",
        [_company_domain()],
        {"fields": ["name", "job_title", "work_email", "user_id"], "order": "name"},
    )
