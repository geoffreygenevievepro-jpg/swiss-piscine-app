"""Configuration de l'API terrain Swiss Piscine.

Lit les variables d'environnement (préfixe APP_) et le .env du backend pour les
credentials Odoo. Le secret JWT est généré et persisté automatiquement en dev
s'il n'est pas fourni, pour que l'API démarre sans configuration manuelle.
"""
import secrets
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_DIR = Path(__file__).resolve().parents[1]      # swiss-piscine-app/backend
SECRET_FILE = BACKEND_DIR / ".secret_key"              # gitignored


def _load_or_create_secret() -> str:
    """Renvoie un secret JWT stable (généré une fois et persisté en local)."""
    if SECRET_FILE.exists():
        return SECRET_FILE.read_text(encoding="utf-8").strip()
    token = secrets.token_urlsafe(48)
    SECRET_FILE.write_text(token, encoding="utf-8")
    return token


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_prefix="APP_",
        env_file=str(BACKEND_DIR / ".env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    app_name: str = "App Équipe Swiss Piscine"
    # Société Odoo : Swiss Piscine UNIQUEMENT
    company_id: int = 5

    # Auth / JWT
    jwt_secret: str = ""                # vide => généré/persisté automatiquement
    jwt_algorithm: str = "HS256"
    access_token_ttl_min: int = 15
    refresh_token_ttl_days: int = 30

    # Sécurité login
    max_failed_attempts: int = 5
    lockout_minutes: int = 15
    # 2FA exigée à la connexion (appareil non fiable). APP_TWOFA_REQUIRED=false pour
    # la désactiver temporairement (tests) ; true = comportement normal.
    twofa_required: bool = True
    # Sociétés (company_id Odoo) exemptées de 2FA, CSV — provisoire. Ex: APP_TWOFA_EXEMPT_COMPANIES=1
    twofa_exempt_companies: str = ""

    def twofa_exempt_set(self) -> set[int]:
        return {int(x) for x in self.twofa_exempt_companies.split(",") if x.strip().isdigit()}

    # CORS : origines autorisées pour la PWA (dev local + futur sous-domaine)
    cors_origins: list[str] = [
        "http://localhost:5500",
        "http://127.0.0.1:5500",
        "http://localhost:8080",
        "https://app.swiss-piscine.ch",
        "https://equipe.heiwa-solution.ch",
    ]

    # SQLite (comptes employés + refresh tokens)
    db_path: str = str(BACKEND_DIR / "data" / "app.db")

    # Supabase (lecture seule des droits d'accès App RH, pilotés depuis vue.heiwa)
    supabase_url: str = ""
    supabase_key: str = ""

    def resolved_jwt_secret(self) -> str:
        return self.jwt_secret or _load_or_create_secret()


settings = Settings()
