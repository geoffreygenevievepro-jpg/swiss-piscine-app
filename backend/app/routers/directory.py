"""Annuaire contacts + documents commerciaux (devis/factures) — lecture seule.

- /contacts : clients de la société, visible par tous les employés.
- /sales-docs : devis & factures, réservé bureau / managers / admin (données financières).
"""
from fastapi import APIRouter, Depends, HTTPException

from .. import odoo
from ..deps import get_current_employee
from ..errors import odoo_unavailable

router = APIRouter(tags=["directory"])

_OFFICE_ROLES = ("office", "manager", "admin")


def _company_id(emp) -> int:
    return emp["company_id"] if emp["company_id"] else odoo.employee_company_id(emp["hr_employee_id"])


def _require_office(emp) -> None:
    if emp["role"] not in _OFFICE_ROLES:
        raise HTTPException(403, "Accès réservé au bureau et au management")


def _norm_kind(kind: str) -> str:
    if kind not in ("devis", "facture"):
        raise HTTPException(404, "Type inconnu (devis|facture)")
    return kind


@router.get("/contacts")
def contacts(q: str | None = None, emp=Depends(get_current_employee)):
    """Annuaire clients de la société de l'employé (lecture seule, visible par tous)."""
    try:
        return odoo.list_contacts(_company_id(emp), q)
    except Exception as e:
        raise odoo_unavailable(e)


@router.get("/sales-docs")
def sales_docs(kind: str = "devis", q: str | None = None, emp=Depends(get_current_employee)):
    """Liste des devis ou factures de la société (bureau / managers / admin)."""
    _require_office(emp)
    try:
        return odoo.list_sale_documents(_company_id(emp), _norm_kind(kind), q)
    except HTTPException:
        raise
    except Exception as e:
        raise odoo_unavailable(e)


@router.get("/sales-docs/{kind}/{doc_id}")
def sales_doc_detail(kind: str, doc_id: int, emp=Depends(get_current_employee)):
    """Fiche lecture seule (en-tête + lignes + totaux) d'un devis/facture."""
    _require_office(emp)
    try:
        detail = odoo.sale_document_detail(_company_id(emp), _norm_kind(kind), doc_id)
    except HTTPException:
        raise
    except Exception as e:
        raise odoo_unavailable(e)
    if detail is None:
        raise HTTPException(404, "Document introuvable")
    return detail


@router.get("/sales-docs/{kind}/{doc_id}/pdf")
def sales_doc_pdf(kind: str, doc_id: int, emp=Depends(get_current_employee)):
    """PDF stocké du devis/facture en base64 ({available, datas, name}). available=False
    si aucun PDF stocké → le frontend bascule sur la fiche."""
    _require_office(emp)
    try:
        pdf = odoo.sale_document_pdf(_company_id(emp), _norm_kind(kind), doc_id)
    except HTTPException:
        raise
    except Exception as e:
        raise odoo_unavailable(e)
    if pdf is None:
        return {"available": False}
    return {"available": True, "datas": pdf["b64"], "name": pdf["filename"]}
