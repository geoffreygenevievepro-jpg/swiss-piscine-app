"""Interventions planifiées du jour (planning.slot) pour l'employé courant."""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from .. import odoo
from ..deps import get_current_employee
from ..errors import odoo_unavailable

router = APIRouter(tags=["interventions"])


class ProductLine(BaseModel):
    name: str = Field(..., max_length=200)       # produit (Odoo ou libre)
    qty: float = 1.0
    price: float | None = None                   # prix unitaire (optionnel)
    product_id: int | None = None                # product.product Odoo (si choisi au catalogue)


class NewIntervention(BaseModel):
    name: str = Field("", max_length=2000)       # description
    type: str | None = None                      # type d'intervention
    date: str                                    # YYYY-MM-DD (heure locale)
    start_time: str = "08:00"                    # HH:MM
    end_time: str = "09:00"                       # HH:MM
    partner_id: int | None = None                # client Odoo (optionnel)
    client_name: str | None = None               # client libre (NON créé dans Odoo)
    photos: list[str] = []                       # images base64 (data URL acceptée)
    products: list[ProductLine] = []             # lignes produits (style devis)
    discount: float = 0.0                        # remise globale %
    vat_rate: float = 8.1                        # TVA %
    tag_ids: list[int] = []                      # tags (à facturer, SAV…)
    signature: str | None = None                 # signature client base64
    status: str = Field("todo", pattern="^(done|todo)$")  # statut obligatoire
    worker_ids: list[int] = []                   # employés ayant travaillé sur le chantier
    materials: str | None = None                 # matériel utilisé (fiche de chantier)
    next_action: str | None = None               # rappel | appel | devis (prochaine action)
    next_action_date: str | None = None          # YYYY-MM-DD (échéance)


class NewPartner(BaseModel):
    name: str = Field(..., min_length=2, max_length=120)
    zip: str | None = None
    city: str | None = None
    street: str | None = None
    phone: str | None = None
    email: str | None = None


class Report(BaseModel):
    type: str = Field(..., min_length=1)
    notes: str | None = None
    materials: str | None = None
    schedule: str | None = None       # ex. "08:00 – 10:30" (affichage)
    hours: float | None = None        # durée en heures (pour le timesheet)
    photos: list[str] = []            # images base64 (data URL acceptée)
    signature: str | None = None      # image base64 (data URL acceptée)
    parts: list[str] = []             # pièces utilisées (noms de produits)
    tag_ids: list[int] = []           # project.tags à poser sur la tâche (à facturer, SAV…)
    worker_ids: list[int] = []        # employés ayant travaillé sur cette tâche
    next_action: str | None = None    # rappel | appel | devis | rien
    next_action_date: str | None = None  # YYYY-MM-DD (échéance de l'activité)


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
    if odoo.slot_overlaps(emp["hr_employee_id"], start_utc, end_utc):
        raise HTTPException(409, "Ce créneau chevauche une autre intervention.")
    try:
        res = odoo.create_intervention(
            emp["hr_employee_id"], body.name, start_utc, end_utc,
            partner_id=body.partner_id, client_name=body.client_name,
            type_label=body.type, photos=body.photos,
            products=[p.model_dump() for p in body.products],
            discount=body.discount, vat_rate=body.vat_rate,
            tag_ids=body.tag_ids, signature=body.signature,
            status=body.status, employee_name=emp["name"],
            worker_ids=body.worker_ids, materials=body.materials,
            next_action=body.next_action, next_action_date=body.next_action_date,
            schedule=f"{body.start_time} – {body.end_time}",
        )
    except Exception as e:
        raise odoo_unavailable(e)
    return res


@router.get("/employees")
def employees(emp=Depends(get_current_employee)):
    """Liste des employés (company 5) pour désigner qui a travaillé sur le chantier."""
    return [{"id": e["id"], "name": e["name"]} for e in odoo.list_employees()]


@router.get("/partners/search")
def partners(q: str, emp=Depends(get_current_employee)):
    if len(q.strip()) < 2:
        return []
    return odoo.search_partners(q.strip(), odoo.employee_company_id(emp["hr_employee_id"]))


@router.post("/partners", status_code=201)
def create_partner(body: NewPartner, emp=Depends(get_current_employee)):
    """Création rapide d'un client (intervention imprévue avec nouveau client)."""
    try:
        pid = odoo.create_partner(body.name, body.zip, body.city, body.street, body.phone, body.email)
    except Exception as e:
        raise odoo_unavailable(e)
    return {"id": pid, "name": body.name}


@router.get("/report-types")
def report_types(emp=Depends(get_current_employee)):
    return odoo.REPORT_TYPES


@router.get("/report-tags")
def report_tags(emp=Depends(get_current_employee)):
    return odoo.REPORT_TAGS


@router.get("/products/search")
def products_search(q: str, emp=Depends(get_current_employee)):
    """Recherche de pièces/produits pour la checklist du rapport."""
    if len(q.strip()) < 2:
        return []
    return odoo.search_report_products(q.strip())


@router.post("/interventions/{slot_id}/report", status_code=201)
def submit_report(slot_id: int, body: Report, emp=Depends(get_current_employee)):
    try:
        res = odoo.submit_report(emp["hr_employee_id"], emp["name"], slot_id, body.model_dump())
    except Exception as e:
        raise odoo_unavailable(e)
    if res is None:
        raise HTTPException(404, "Intervention introuvable ou non assignée")
    return res
