"""Logique 2FA : TOTP, chiffrement du secret, codes email, jetons d'appareil."""
import base64
import hashlib
import hmac
import secrets

import pyotp
from cryptography.fernet import Fernet

from .config import settings

ISSUER = "Swiss Piscine"


def _fernet() -> Fernet:
    # Clé Fernet (32 octets url-safe b64) dérivée du secret applicatif.
    key = hashlib.sha256(settings.resolved_jwt_secret().encode("utf-8")).digest()
    return Fernet(base64.urlsafe_b64encode(key))


# --- TOTP ---
def new_secret() -> str:
    return pyotp.random_base32()

def provisioning_uri(secret: str, login: str) -> str:
    return pyotp.TOTP(secret).provisioning_uri(name=login, issuer_name=ISSUER)

def verify_totp(secret: str, code: str) -> bool:
    try:
        return pyotp.TOTP(secret).verify(code, valid_window=1)
    except Exception:
        return False


# --- Chiffrement du secret ---
def encrypt(s: str) -> str:
    return _fernet().encrypt(s.encode("utf-8")).decode("utf-8")

def decrypt(s: str) -> str:
    return _fernet().decrypt(s.encode("utf-8")).decode("utf-8")


# --- Codes email ---
def generate_email_code() -> str:
    return f"{secrets.randbelow(1_000_000):06d}"

def hash_code(code: str) -> str:
    return hashlib.sha256((settings.resolved_jwt_secret() + code).encode("utf-8")).hexdigest()


# --- Jetons d'appareil de confiance ---
def new_device_token() -> str:
    return secrets.token_urlsafe(32)

def hash_token(token: str) -> str:
    return hashlib.sha256((settings.resolved_jwt_secret() + token).encode("utf-8")).hexdigest()
