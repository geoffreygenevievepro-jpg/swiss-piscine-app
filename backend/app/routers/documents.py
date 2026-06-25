"""Endpoints Documents : dossiers de l'employé (Documents Odoo) + dépôt médical."""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from .. import odoo
from ..deps import get_current_employee
from ..errors import odoo_unavailable

router = APIRouter(prefix="/documents", tags=["documents"])


class MedicalUpload(BaseModel):
    name: str = Field(..., min_length=1, max_length=200)   # nom de fichier
    mimetype: str = "application/octet-stream"
    data: str = Field(..., min_length=10)                  # base64 (data URL acceptée)


@router.get("/all")
def all_documents(emp=Depends(get_current_employee)):
    """Documents par catégorie : personnels, contrat, certificats de salaire, médicaux."""
    return odoo.employee_documents(emp["hr_employee_id"])


@router.get("/file/{doc_id}")
def file(doc_id: int, emp=Depends(get_current_employee)):
    res = odoo.document_file(emp["hr_employee_id"], doc_id)
    if res is None:
        raise HTTPException(404, "Document introuvable ou non autorisé")
    return res


@router.post("/medical", status_code=201)
def upload_medical(body: MedicalUpload, emp=Depends(get_current_employee)):
    try:
        res = odoo.upload_medical_document(emp["hr_employee_id"], body.name, body.data, body.mimetype)
    except Exception as e:
        raise odoo_unavailable(e)
    if res is None:
        raise HTTPException(404, "Dossier « Maladie » introuvable pour cet employé")
    return res
