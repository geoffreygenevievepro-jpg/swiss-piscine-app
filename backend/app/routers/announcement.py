"""Message à l'équipe : lu par tous, écrit par les managers/admins."""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from .. import db
from ..deps import get_current_employee

router = APIRouter(tags=["announcement"])


class Announcement(BaseModel):
    text: str = Field("", max_length=1000)


@router.get("/announcement")
def get_announcement(emp=Depends(get_current_employee)):
    row = db.get_announcement()
    if not row:
        return {"text": "", "author": "", "updated_at": None}
    return {"text": row["text"] or "", "author": row["author"] or "", "updated_at": row["updated_at"]}


@router.put("/announcement")
def set_announcement(body: Announcement, emp=Depends(get_current_employee)):
    if emp["role"] not in ("manager", "admin"):
        raise HTTPException(403, "Réservé aux responsables")
    db.set_announcement(body.text.strip(), emp["name"])
    return {"ok": True}
