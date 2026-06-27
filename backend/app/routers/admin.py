"""Endpoints Admin : vue d'ensemble équipe (heures par employé, tous les congés)."""
from fastapi import APIRouter, Depends, HTTPException

from .. import db, odoo
from ..deps import get_current_employee

router = APIRouter(prefix="/admin", tags=["admin"])


def require_admin(emp=Depends(get_current_employee)):
    if emp["role"] != "admin":
        raise HTTPException(403, "Réservé à l'administration")
    return emp


@router.get("/employees-hours")
def employees_hours(emp=Depends(require_admin)):
    company_id = odoo.employee_company_id(emp["hr_employee_id"])
    return odoo.admin_employees_hours(company_id)


@router.get("/leaves")
def all_leaves(emp=Depends(require_admin)):
    company_id = odoo.employee_company_id(emp["hr_employee_id"])
    return odoo.admin_leaves(company_id)


@router.post("/employees/{emp_id}/reset-2fa")
def reset_2fa(emp_id: int, _=Depends(require_admin)):
    if db.get_employee_by_id(emp_id) is None:
        raise HTTPException(404, "Employé introuvable")
    db.reset_twofa(emp_id)
    db.revoke_trusted_devices(emp_id)
    return {"ok": True}
