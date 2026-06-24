"""Endpoints de timbrage (hr.attendance) pour l'employé courant."""
from fastapi import APIRouter, Depends

from .. import odoo
from ..deps import get_current_employee
from ..errors import odoo_unavailable

router = APIRouter(prefix="/attendance", tags=["attendance"])


@router.get("/status")
def status(emp=Depends(get_current_employee)):
    return odoo.attendance_status(emp["hr_employee_id"])


@router.post("/check-in")
def check_in(emp=Depends(get_current_employee)):
    try:
        return odoo.check_in(emp["hr_employee_id"])
    except Exception as e:
        raise odoo_unavailable(e)


@router.post("/check-out")
def check_out(emp=Depends(get_current_employee)):
    try:
        return odoo.check_out(emp["hr_employee_id"])
    except Exception as e:
        raise odoo_unavailable(e)
