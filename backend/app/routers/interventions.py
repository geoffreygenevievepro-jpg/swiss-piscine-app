"""Interventions planifiées du jour (planning.slot) pour l'employé courant."""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from .. import odoo
from ..deps import get_current_employee

router = APIRouter(tags=["interventions"])


class NewIntervention(BaseModel):
    name: str = Field(..., min_length=1, max_length=200)
    date: str                       # YYYY-MM-DD (heure locale)
    start_time: str = "08:00"       # HH:MM
    end_time: str = "09:00"         # HH:MM
    partner_id: int | None = None


@router.get("/interventions/today")
def today(emp=Depends(get_current_employee)):
    return odoo.today_interventions(emp["hr_employee_id"])


@router.get("/interventions/{slot_id}")
def detail(slot_id: int, emp=Depends(get_current_employee)):
    slot = odoo.intervention_detail(slot_id, emp["hr_employee_id"])
    if slot is None:
        raise HTTPException(404, "Intervention introuvable ou non assignée")
    return slot


@router.post("/interventions", status_code=201)
def create(body: NewIntervention, emp=Depends(get_current_employee)):
    try:
        start_utc = odoo.local_dt_to_utc(body.date, body.start_time)
        end_utc = odoo.local_dt_to_utc(body.date, body.end_time)
    except ValueError:
        raise HTTPException(422, "Date ou heure invalide")
    if end_utc <= start_utc:
        raise HTTPException(422, "L'heure de fin doit être après l'heure de début")
    try:
        slot_id = odoo.create_intervention(
            emp["hr_employee_id"], body.name, start_utc, end_utc, body.partner_id,
        )
    except Exception as e:
        raise HTTPException(502, f"Odoo indisponible : {e}")
    return {"id": slot_id}


@router.get("/partners/search")
def partners(q: str, emp=Depends(get_current_employee)):
    if len(q.strip()) < 2:
        return []
    return odoo.search_partners(q.strip())
