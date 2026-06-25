"""Endpoints Notes de frais (hr.expense) pour l'employé courant."""
from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from .. import odoo
from ..deps import get_current_employee
from ..errors import odoo_unavailable

router = APIRouter(prefix="/expenses", tags=["expenses"])


class NewExpense(BaseModel):
    name: str = Field("", max_length=200)        # libellé
    amount: float = Field(..., gt=0)             # montant TTC
    category_id: int | None = None               # product.product (catégorie)
    tax_id: int | None = 153                     # TVA (8.1 % par défaut)
    date: str | None = None                      # YYYY-MM-DD
    description: str | None = None
    photos: list[str] = []                       # reçus base64


@router.get("/options")
def options(emp=Depends(get_current_employee)):
    return odoo.expense_options()


@router.get("")
def list_expenses(emp=Depends(get_current_employee)):
    return odoo.my_expenses(emp["hr_employee_id"])


@router.post("", status_code=201)
def create(body: NewExpense, emp=Depends(get_current_employee)):
    try:
        return odoo.create_expense(
            emp["hr_employee_id"], body.name, body.amount, body.category_id,
            body.tax_id, body.date, body.description, body.photos,
        )
    except Exception as e:
        raise odoo_unavailable(e)
