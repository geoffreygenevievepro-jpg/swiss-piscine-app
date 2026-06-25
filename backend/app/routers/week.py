"""Endpoints Semaine : planning de la semaine (navigable) + grille équipe."""
from fastapi import APIRouter, Depends

from .. import odoo
from ..deps import get_current_employee

router = APIRouter(prefix="/week", tags=["week"])


@router.get("/planning")
def planning(offset: int = 0, emp=Depends(get_current_employee)):
    return odoo.week_planning(emp["hr_employee_id"], offset)


@router.get("/team")
def team(offset: int = 0, emp=Depends(get_current_employee)):
    return odoo.team_week(offset)


@router.get("/upcoming")
def upcoming(days: int = 5, emp=Depends(get_current_employee)):
    return odoo.upcoming_planning(emp["hr_employee_id"], days)


@router.get("/holidays")
def holidays(emp=Depends(get_current_employee)):
    return odoo.upcoming_holidays()