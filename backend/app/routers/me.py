"""Endpoint /me : profil de l'employé courant (SQLite + données Odoo)."""
from fastapi import APIRouter, Depends

from .. import odoo
from ..deps import get_current_employee

router = APIRouter(tags=["me"])


@router.get("/me")
def me(emp=Depends(get_current_employee)):
    """Profil employé : compte local + données fraîches depuis Odoo."""
    odoo_profile = None
    extra = {}
    try:
        odoo_profile = odoo.get_employee(emp["hr_employee_id"])
        extra = odoo.employee_extra(emp["hr_employee_id"])
    except Exception:
        # L'app reste utilisable même si Odoo est momentanément injoignable.
        odoo_profile = None

    return {
        "id": emp["id"],
        "login": emp["login"],
        "name": emp["name"],
        "role": emp["role"],
        "hr_employee_id": emp["hr_employee_id"],
        "odoo": odoo_profile,
        "avatar": extra.get("avatar"),
        "activity_rate": extra.get("activity_rate"),
        "resume": extra.get("resume", []),
    }
