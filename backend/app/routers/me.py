"""Endpoint /me : profil de l'employé courant (SQLite + données Odoo)."""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from .. import db, odoo, supabase_access
from ..config import settings
from ..deps import get_current_employee
from ..errors import odoo_unavailable
from ..security import hash_pin, verify_pin

router = APIRouter(tags=["me"])


class PermitScan(BaseModel):
    data: str = Field(..., min_length=10)   # base64 (data URL acceptée)


class PinChange(BaseModel):
    current_pin: str = Field(..., min_length=4, max_length=12)
    new_pin: str = Field(..., min_length=4, max_length=12)


@router.get("/me")
def me(emp=Depends(get_current_employee)):
    """Profil employé : compte local + données fraîches depuis Odoo."""
    odoo_profile = None
    extra = {}
    try:
        odoo_profile = odoo.get_employee(emp["hr_employee_id"])
        extra = odoo.employee_extra(emp["hr_employee_id"])
    except Exception:
        # L'app reste utilisable même si Odoo est momentanément injoignable.
        odoo_profile = None

    # Onglets contrôlables visibles pour cet employé (droits App RH, vue.heiwa).
    cid = emp["company_id"] if emp["company_id"] else settings.company_id
    effective_tabs = supabase_access.access_decision(
        emp["hr_employee_id"], cid
    )["effective_tabs"]

    branding = odoo.company_branding(cid)
    color = supabase_access.company_theme_color(cid) or "#0c5e68"

    return {
        "id": emp["id"],
        "login": emp["login"],
        "name": emp["name"],
        "role": emp["role"],
        "hr_employee_id": emp["hr_employee_id"],
        "effective_tabs": effective_tabs,
        "odoo": odoo_profile,
        "avatar": extra.get("avatar"),
        "activity_rate": extra.get("activity_rate"),
        "resume": extra.get("resume", []),
        "company": {**branding, "color": color},
    }


@router.get("/me/details")
def details(emp=Depends(get_current_employee)):
    """Champs personnels modifiables de l'employé (adresse, permis, famille…)."""
    return odoo.employee_details(emp["hr_employee_id"])


@router.patch("/me/details")
def update_details(body: dict, emp=Depends(get_current_employee)):
    try:
        return odoo.update_employee_details(emp["hr_employee_id"], body)
    except Exception as e:
        raise odoo_unavailable(e)


@router.get("/me/countries")
def countries(emp=Depends(get_current_employee)):
    return odoo.list_countries()


@router.post("/me/pin")
def change_pin(body: PinChange, emp=Depends(get_current_employee)):
    """Change le PIN : écrit dans Odoo (hr.employee.pin = référence) + maj du hash local."""
    if not verify_pin(body.current_pin, emp["pin_hash"]):
        raise HTTPException(403, "PIN actuel incorrect")
    if not body.new_pin.isdigit() or not (4 <= len(body.new_pin) <= 8):
        raise HTTPException(422, "Le nouveau PIN doit comporter 4 à 8 chiffres")
    try:
        odoo.set_employee_pin(emp["hr_employee_id"], body.new_pin)
    except Exception as e:
        raise odoo_unavailable(e)
    db.update_pin(emp["id"], hash_pin(body.new_pin))
    return {"ok": True}


@router.post("/me/permit-scan", status_code=201)
def permit_scan(body: PermitScan, emp=Depends(get_current_employee)):
    try:
        return odoo.upload_permit_scan(emp["hr_employee_id"], body.data)
    except Exception as e:
        raise odoo_unavailable(e)
