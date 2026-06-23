"""Endpoints interventions du jour (project.task) pour l'employé courant."""
from fastapi import APIRouter, Depends, HTTPException

from .. import odoo
from ..deps import get_current_employee

router = APIRouter(prefix="/tasks", tags=["tasks"])


@router.get("/today")
def today(emp=Depends(get_current_employee)):
    return odoo.today_tasks(emp["hr_employee_id"])


@router.get("/{task_id}")
def detail(task_id: int, emp=Depends(get_current_employee)):
    task = odoo.task_detail(task_id, emp["hr_employee_id"])
    if task is None:
        raise HTTPException(404, "Intervention introuvable ou non assignée")
    return task
