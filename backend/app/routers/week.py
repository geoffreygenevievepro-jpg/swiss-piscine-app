"""Endpoints Semaine : planning de la semaine + absences de l'équipe."""
from fastapi import APIRouter, Depends

from .. import odoo
from ..deps import get_current_employee

router = APIRouter(prefix="/week", tags=["week"])


@router.get("/planning")
def planning(emp=Depends(get_current_employee)):
    return odoo.week_planning(emp["hr_employee_id"])


@router.get("/absences")
def absences(emp=Depends(get_current_employee)):
    return odoo.team_absences()
