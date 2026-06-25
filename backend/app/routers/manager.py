"""Endpoints manager : valider / refuser les demandes de congé de l'équipe."""
from fastapi import APIRouter, Depends, HTTPException

from .. import odoo
from ..deps import get_current_employee
from ..errors import odoo_unavailable

router = APIRouter(prefix="/manager", tags=["manager"])


def require_staff(emp=Depends(get_current_employee)):
    if emp["role"] not in ("manager", "admin"):
        raise HTTPException(403, "Réservé aux responsables")
    return emp


def _ensure_can_manage(emp, leave_id: int) -> None:
    """Un manager ne peut agir que sur les demandes de SON équipe ; admin = tout."""
    if emp["role"] == "admin":
        return
    if not odoo.leave_belongs_to_manager(leave_id, emp["hr_employee_id"]):
        raise HTTPException(403, "Cette demande n'est pas dans ton équipe")


@router.get("/leaves")
def leaves_to_approve(emp=Depends(require_staff)):
    # Admin : toutes les demandes. Manager : seulement son équipe (parent_id).
    if emp["role"] == "admin":
        return odoo.pending_leaves()
    return odoo.pending_leaves(manager_hr_id=emp["hr_employee_id"])


@router.post("/leaves/{leave_id}/approve", status_code=204)
def approve(leave_id: int, emp=Depends(require_staff)):
    _ensure_can_manage(emp, leave_id)
    try:
        odoo.approve_leave(leave_id)
    except Exception as e:
        raise odoo_unavailable(e)


@router.post("/leaves/{leave_id}/refuse", status_code=204)
def refuse(leave_id: int, emp=Depends(require_staff)):
    _ensure_can_manage(emp, leave_id)
    try:
        odoo.refuse_leave(leave_id)
    except Exception as e:
        raise odoo_unavailable(e)
