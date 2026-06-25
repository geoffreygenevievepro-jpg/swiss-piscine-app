"""Endpoints d'authentification : login (PIN), refresh, logout."""
from datetime import datetime, timezone

import jwt
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field

from .. import db, supabase_access
from ..config import settings
from ..deps import get_current_employee
from ..security import (
    create_access_token,
    create_refresh_token,
    decode_token,
    verify_pin,
)

router = APIRouter(prefix="/auth", tags=["auth"])


class LoginRequest(BaseModel):
    login: str = Field(..., min_length=1, max_length=64)
    pin: str = Field(..., min_length=4, max_length=12)


class RefreshRequest(BaseModel):
    refresh_token: str


class TokenResponse(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    expires_in: int  # secondes


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _issue_tokens(employee_id: int, login: str, role: str) -> TokenResponse:
    access = create_access_token(employee_id, login, role)
    refresh, jti, expires_at = create_refresh_token(employee_id)
    db.store_refresh_token(jti, employee_id, expires_at.isoformat())
    return TokenResponse(
        access_token=access,
        refresh_token=refresh,
        expires_in=settings.access_token_ttl_min * 60,
    )


@router.post("/login", response_model=TokenResponse)
def login(body: LoginRequest):
    emp = db.get_employee_by_login(body.login.strip().lower())
    # Réponse uniforme pour ne pas révéler l'existence d'un login.
    invalid = HTTPException(status.HTTP_401_UNAUTHORIZED, "Identifiant ou code PIN incorrect")
    if emp is None:
        raise invalid

    # Verrouillage anti-bruteforce.
    if emp["locked_until"]:
        locked_until = datetime.fromisoformat(emp["locked_until"])
        if locked_until > _now():
            raise HTTPException(
                status.HTTP_429_TOO_MANY_REQUESTS,
                "Compte temporairement verrouillé, réessaie dans quelques minutes",
            )

    if not verify_pin(body.pin, emp["pin_hash"]):
        attempts = emp["failed_attempts"] + 1
        locked_iso = None
        if attempts >= settings.max_failed_attempts:
            from datetime import timedelta
            locked_iso = (_now() + timedelta(minutes=settings.lockout_minutes)).isoformat()
        db.register_failed_attempt(emp["id"], locked_iso)
        raise invalid

    db.reset_failed_attempts(emp["id"])

    # Gate d'accès App RH (piloté depuis vue.heiwa). Fail-open : on refuse
    # uniquement si l'accès est explicitement désactivé côté Supabase.
    if not supabase_access.access_decision(emp["hr_employee_id"], settings.company_id)["allowed"]:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            "Accès suspendu — contactez l'administration RH",
        )

    return _issue_tokens(emp["id"], emp["login"], emp["role"])


@router.post("/refresh", response_model=TokenResponse)
def refresh(body: RefreshRequest):
    invalid = HTTPException(status.HTTP_401_UNAUTHORIZED, "Refresh token invalide")
    try:
        payload = decode_token(body.refresh_token)
    except jwt.PyJWTError:
        raise invalid
    if payload.get("type") != "refresh":
        raise invalid

    jti = payload.get("jti")
    stored = db.get_refresh_token(jti) if jti else None
    if stored is None or stored["revoked"]:
        raise invalid
    if datetime.fromisoformat(stored["expires_at"]) <= _now():
        raise invalid

    emp = db.get_employee_by_id(int(payload["sub"]))
    if emp is None:
        raise invalid

    # Rotation : l'ancien refresh token est révoqué, un nouveau couple est émis.
    db.revoke_refresh_token(jti)
    return _issue_tokens(emp["id"], emp["login"], emp["role"])


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
def logout(emp=Depends(get_current_employee)):
    """Révoque tous les refresh tokens de l'employé courant."""
    db.revoke_all_for_employee(emp["id"])
