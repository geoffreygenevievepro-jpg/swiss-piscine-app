"""Hachage des PIN (PBKDF2 stdlib) et gestion des tokens JWT."""
import base64
import hashlib
import hmac
import os
import uuid
from datetime import datetime, timedelta, timezone

import jwt

from .config import settings

PBKDF2_ROUNDS = 200_000
PBKDF2_ALGO = "pbkdf2_sha256"


# --- PIN hashing -----------------------------------------------------------

def hash_pin(pin: str, salt: bytes | None = None) -> str:
    """Hache un PIN avec PBKDF2-SHA256. Format : algo$rounds$salt_b64$dk_b64."""
    if salt is None:
        salt = os.urandom(16)
    dk = hashlib.pbkdf2_hmac("sha256", pin.encode("utf-8"), salt, PBKDF2_ROUNDS)
    return f"{PBKDF2_ALGO}${PBKDF2_ROUNDS}${base64.b64encode(salt).decode()}${base64.b64encode(dk).decode()}"


def verify_pin(pin: str, stored: str) -> bool:
    """Vérifie un PIN contre un hash stocké (comparaison à temps constant)."""
    try:
        algo, rounds, salt_b64, dk_b64 = stored.split("$")
        if algo != PBKDF2_ALGO:
            return False
        salt = base64.b64decode(salt_b64)
        expected = base64.b64decode(dk_b64)
        dk = hashlib.pbkdf2_hmac("sha256", pin.encode("utf-8"), salt, int(rounds))
        return hmac.compare_digest(dk, expected)
    except Exception:
        return False


# --- JWT -------------------------------------------------------------------

def _now() -> datetime:
    return datetime.now(timezone.utc)


def create_access_token(employee_id: int, login: str, role: str) -> str:
    payload = {
        "sub": str(employee_id),
        "login": login,
        "role": role,
        "type": "access",
        "iat": _now(),
        "exp": _now() + timedelta(minutes=settings.access_token_ttl_min),
    }
    return jwt.encode(payload, settings.resolved_jwt_secret(), algorithm=settings.jwt_algorithm)


def create_refresh_token(employee_id: int) -> tuple[str, str, datetime]:
    """Renvoie (token, jti, expires_at). Le jti est stocké en base pour rotation/révocation."""
    jti = uuid.uuid4().hex
    expires_at = _now() + timedelta(days=settings.refresh_token_ttl_days)
    payload = {
        "sub": str(employee_id),
        "jti": jti,
        "type": "refresh",
        "iat": _now(),
        "exp": expires_at,
    }
    token = jwt.encode(payload, settings.resolved_jwt_secret(), algorithm=settings.jwt_algorithm)
    return token, jti, expires_at


def decode_token(token: str) -> dict:
    """Décode et valide un JWT. Lève jwt.PyJWTError si invalide/expiré."""
    return jwt.decode(token, settings.resolved_jwt_secret(), algorithms=[settings.jwt_algorithm])
