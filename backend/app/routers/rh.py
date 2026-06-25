"""Endpoints RH : soldes, congés (liste + demande), fiches de salaire."""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from datetime import datetime, timezone

from .. import db, odoo
from ..deps import get_current_employee
from ..errors import odoo_unavailable

router = APIRouter(prefix="/rh", tags=["rh"])


class NewLeave(BaseModel):
    type_id: int
    date_from: str                      # YYYY-MM-DD
    date_to: str                        # YYYY-MM-DD
    name: str = Field("", max_length=200)


@router.get("/balances")
def balances(emp=Depends(get_current_employee)):
    return odoo.leave_balances(emp["hr_employee_id"])


@router.get("/leave-types")
def leave_types(emp=Depends(get_current_employee)):
    return odoo.leave_types(emp["hr_employee_id"])


@router.get("/leaves")
def leaves(emp=Depends(get_current_employee)):
    return odoo.my_leaves(emp["hr_employee_id"])


@router.post("/leaves", status_code=201)
def create_leave(body: NewLeave, emp=Depends(get_current_employee)):
    if body.date_to < body.date_from:
        raise HTTPException(422, "La date de fin doit être après la date de début")
    try:
        leave_id = odoo.create_leave(
            emp["hr_employee_id"], body.type_id, body.date_from, body.date_to, body.name,
        )
    except Exception as e:
        raise odoo_unavailable(e)
    # Notifie le manager (supérieur direct) qu'une demande l'attend.
    try:
        mgr = odoo.employee_manager_hr_id(emp["hr_employee_id"])
        if mgr:
            db.insert_notification(
                mgr, "leave_to_approve", "Congé à valider",
                f"{emp['name']} · {body.date_from} → {body.date_to}",
                f"leavereq-{leave_id}",
                datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S"))
    except Exception:
        pass
    return {"id": leave_id}


@router.get("/payslips")
def payslips(emp=Depends(get_current_employee)):
    return odoo.my_payslips(emp["hr_employee_id"])


@router.get("/payslips/{payslip_id}/pdf")
def payslip_pdf(payslip_id: int, emp=Depends(get_current_employee)):
    res = odoo.payslip_pdf(emp["hr_employee_id"], payslip_id)
    if res is None:
        raise HTTPException(404, "Fiche de salaire introuvable")
    return res
