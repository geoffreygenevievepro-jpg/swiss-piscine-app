"""Endpoints Admin : vue d'ensemble équipe (heures par employé, tous les congés)."""
from fastapi import APIRouter, Depends, HTTPException

from .. import odoo
from ..deps import get_current_employee

router = APIRouter(prefix="/admin", tags=["admin"])


def require_admin(emp=Depends(get_current_employee)):
    if emp["role"] != "admin":
        raise HTTPException(403, "Réservé à l'administration")
    return emp


@router.get("/employees-hours")
def employees_hours(emp=Depends(require_admin)):
    return odoo.admin_employees_hours()


@router.get("/leaves")
def all_leaves(emp=Depends(require_admin)):
    return odoo.admin_leaves()
