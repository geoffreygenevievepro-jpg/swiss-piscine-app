"""Dépendances FastAPI : extraction de l'employé courant depuis le JWT."""
import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from . import db
from .security import decode_token

bearer_scheme = HTTPBearer(auto_error=False)


def get_current_employee(
    creds: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
):
    """Valide le token d'accès et renvoie la ligne employee (SQLite)."""
    if creds is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Token manquant")
    try:
        payload = decode_token(creds.credentials)
    except jwt.ExpiredSignatureError:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Token expiré")
    except jwt.PyJWTError:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Token invalide")

    if payload.get("type") != "access":
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Type de token invalide")

    emp = db.get_employee_by_id(int(payload["sub"]))
    if emp is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Compte introuvable ou inactif")
    return emp


def get_pre2fa_employee(
    creds: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
):
    """Valide un token pré-2FA et renvoie la ligne employee. Refuse tout autre type."""
    if creds is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Token manquant")
    try:
        payload = decode_token(creds.credentials)
    except jwt.PyJWTError:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Token invalide")
    if payload.get("type") != "pre2fa":
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Token pré-2FA requis")
    emp = db.get_employee_by_id(int(payload["sub"]))
    if emp is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Compte introuvable")
    return emp
