"""Endpoints de timbrage (hr.attendance) pour l'employé courant."""
from fastapi import APIRouter, Depends
from pydantic import BaseModel

from .. import odoo
from ..deps import get_current_employee
from ..errors import odoo_unavailable

router = APIRouter(prefix="/attendance", tags=["attendance"])


class Punch(BaseModel):
    lat: float | None = None
    lng: float | None = None


@router.get("/status")
def status(emp=Depends(get_current_employee)):
    return odoo.attendance_status(emp["hr_employee_id"])


@router.post("/check-in")
def check_in(body: Punch | None = None, emp=Depends(get_current_employee)):
    b = body or Punch()
    try:
        return odoo.check_in(emp["hr_employee_id"], b.lat, b.lng)
    except Exception as e:
        raise odoo_unavailable(e)


@router.post("/check-out")
def check_out(body: Punch | None = None, emp=Depends(get_current_employee)):
    b = body or Punch()
    try:
        return odoo.check_out(emp["hr_employee_id"], b.lat, b.lng)
    except Exception as e:
        raise odoo_unavailable(e)
