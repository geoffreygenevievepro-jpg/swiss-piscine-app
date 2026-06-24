"""Endpoints manager : valider / refuser les demandes de congé de l'équipe."""
from fastapi import APIRouter, Depends, HTTPException

from .. import odoo
from ..deps import get_current_employee
from ..errors import odoo_unavailable

router = APIRouter(prefix="/manager", tags=["manager"])


def require_manager(emp=Depends(get_current_employee)):
    if emp["role"] != "manager":
        raise HTTPException(403, "Réservé aux responsables")
    return emp


@router.get("/leaves")
def leaves_to_approve(emp=Depends(require_manager)):
    return odoo.pending_leaves()


@router.post("/leaves/{leave_id}/approve", status_code=204)
def approve(leave_id: int, emp=Depends(require_manager)):
    try:
        odoo.approve_leave(leave_id)
    except Exception as e:
        raise odoo_unavailable(e)


@router.post("/leaves/{leave_id}/refuse", status_code=204)
def refuse(leave_id: int, emp=Depends(require_manager)):
    try:
        odoo.refuse_leave(leave_id)
    except Exception as e:
        raise odoo_unavailable(e)
