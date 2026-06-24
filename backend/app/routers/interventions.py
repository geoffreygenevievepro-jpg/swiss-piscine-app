"""Interventions planifiées du jour (planning.slot) pour l'employé courant."""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from .. import odoo
from ..deps import get_current_employee
from ..errors import odoo_unavailable

router = APIRouter(tags=["interventions"])


class NewIntervention(BaseModel):
    name: str = Field("", max_length=400)        # description
    type: str | None = None                      # type d'intervention
    date: str                                    # YYYY-MM-DD (heure locale)
    start_time: str = "08:00"                    # HH:MM
    end_time: str = "09:00"                       # HH:MM
    partner_id: int                              # client OBLIGATOIRE
    photos: list[str] = []                       # images base64 (data URL acceptée)


class Report(BaseModel):
    type: str = Field(..., min_length=1)
    notes: str | None = None
    materials: str | None = None
    schedule: str | None = None       # ex. "08:00 – 10:30" (affichage)
    hours: float | None = None        # durée en heures (pour le timesheet)
    photos: list[str] = []            # images base64 (data URL acceptée)
    signature: str | None = None      # image base64 (data URL acceptée)


@router.get("/interventions/today")
def today(date: str | None = None, emp=Depends(get_current_employee)):
    return odoo.today_interventions(emp["hr_employee_id"], date)


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
            emp["hr_employee_id"], body.name, start_utc, end_utc,
            body.partner_id, body.type, body.photos,
        )
    except Exception as e:
        raise odoo_unavailable(e)
    return {"id": slot_id}


@router.get("/partners/search")
def partners(q: str, emp=Depends(get_current_employee)):
    if len(q.strip()) < 2:
        return []
    return odoo.search_partners(q.strip())


@router.get("/report-types")
def report_types(emp=Depends(get_current_employee)):
    return odoo.REPORT_TYPES


@router.post("/interventions/{slot_id}/report", status_code=201)
def submit_report(slot_id: int, body: Report, emp=Depends(get_current_employee)):
    try:
        res = odoo.submit_report(emp["hr_employee_id"], emp["name"], slot_id, body.model_dump())
    except Exception as e:
        raise odoo_unavailable(e)
    if res is None:
        raise HTTPException(404, "Intervention introuvable ou non assignée")
    return res
