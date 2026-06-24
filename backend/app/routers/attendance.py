"""Endpoints de timbrage (hr.attendance) pour l'employé courant."""
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from .. import odoo
from ..deps import get_current_employee
from ..errors import odoo_unavailable

router = APIRouter(prefix="/attendance", tags=["attendance"])


class Punch(BaseModel):
    lat: float | None = None
    lng: float | None = None


class ManualAttendance(BaseModel):
    date: str          # YYYY-MM-DD (jour local)
    check_in: str      # HH:MM
    check_out: str     # HH:MM


@router.get("/status")
def status(emp=Depends(get_current_employee)):
    return odoo.attendance_status(emp["hr_employee_id"])


@router.get("/summary")
def summary(period: str = "week", offset: int = 0, emp=Depends(get_current_employee)):
    if period not in ("day", "week", "month"):
        period = "week"
    return odoo.attendance_summary(emp["hr_employee_id"], period, offset)


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


# --- Saisie manuelle / édition (< 24 h) -----------------------------------

def _window_utc(date: str, ci: str, co: str) -> tuple[str, str]:
    """Convertit date + heures locales en bornes UTC, avec validations."""
    try:
        start = odoo.local_dt_to_utc(date, ci)
        end = odoo.local_dt_to_utc(date, co)
    except ValueError:
        raise HTTPException(422, "Date ou heure invalide")
    s = datetime.strptime(start, odoo.ODOO_FMT)
    e = datetime.strptime(end, odoo.ODOO_FMT)
    if e <= s:
        raise HTTPException(422, "L'heure de fin doit être après l'heure de début")
    if (e - s).total_seconds() > 12 * 3600:
        raise HTTPException(422, "Durée supérieure à 12 h")
    return start, end


def _raise_attendance_error(res: dict) -> None:
    if res.get("error") == "not_found":
        raise HTTPException(404, "Pointage introuvable")
    if res.get("error") == "locked":
        raise HTTPException(403, "Modifiable uniquement dans les 24 h")


@router.get("/today")
def today(date: str | None = None, emp=Depends(get_current_employee)):
    return odoo.attendance_today_detail(emp["hr_employee_id"], date)


@router.post("/manual", status_code=201)
def manual(body: ManualAttendance, emp=Depends(get_current_employee)):
    start, end = _window_utc(body.date, body.check_in, body.check_out)
    if odoo.attendance_overlaps(emp["hr_employee_id"], start, end):
        raise HTTPException(409, "Ce pointage en chevauche un autre.")
    try:
        return odoo.create_manual_attendance(emp["hr_employee_id"], start, end)
    except Exception as e:
        raise odoo_unavailable(e)


@router.patch("/{att_id}")
def edit(att_id: int, body: ManualAttendance, emp=Depends(get_current_employee)):
    start, end = _window_utc(body.date, body.check_in, body.check_out)
    if odoo.attendance_overlaps(emp["hr_employee_id"], start, end, exclude_id=att_id):
        raise HTTPException(409, "Ce pointage en chevauche un autre.")
    try:
        res = odoo.update_attendance(emp["hr_employee_id"], att_id, start, end)
    except Exception as e:
        raise odoo_unavailable(e)
    _raise_attendance_error(res)
    return res


@router.delete("/{att_id}")
def remove(att_id: int, emp=Depends(get_current_employee)):
    try:
        res = odoo.delete_attendance(emp["hr_employee_id"], att_id)
    except Exception as e:
        raise odoo_unavailable(e)
    _raise_attendance_error(res)
    return res
