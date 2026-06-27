"""Lecture seule des droits d'accès App RH dans Supabase.

Les droits sont pilotés depuis vue.heiwa (qui écrit les tables) ; cette app ne
fait que LIRE (clé anon, policy select). Politique anti-verrouillage : on ne
refuse l'accès que si une ligne existe ET dit explicitement access_active=false.
Toute absence de ligne ou erreur réseau → fail-open (on laisse entrer).
"""
from __future__ import annotations

import requests

from .config import settings

# Écrans contrôlables (= ids d'écrans frontend). Accueil/Pointer/Moi sont
# toujours visibles ; Admin est gardé par le rôle in-app. Doit rester aligné
# avec APP_RH_TAB_KEYS côté vue.heiwa.
CONTROLLABLE_TABS = ["terrain", "planning", "conges", "notesfrais", "documents"]

_TIMEOUT = 5


def resolve_effective_tabs(allowed: list[str], company_enabled: list[str]) -> list[str]:
    """Onglets effectifs : la société est le plafond.

    - allowed vide → tous les onglets activés de la société,
    - allowed non vide → intersection avec ceux de la société.
    Ordre canonique préservé, clés inconnues filtrées.
    """
    cap = [t for t in (company_enabled or []) if t in CONTROLLABLE_TABS]
    if not allowed:
        base = set(cap)
    else:
        base = {t for t in allowed if t in cap}
    return [t for t in CONTROLLABLE_TABS if t in base]


def _headers() -> dict:
    key = settings.supabase_key
    return {"apikey": key, "Authorization": f"Bearer {key}"}


def _get(path: str) -> list | None:
    """GET PostgREST → liste de lignes, ou None sur erreur/conf absente."""
    if not settings.supabase_url or not settings.supabase_key:
        return None
    try:
        r = requests.get(
            f"{settings.supabase_url}/rest/v1/{path}",
            headers=_headers(),
            timeout=_TIMEOUT,
        )
        if r.status_code != 200:
            return None
        data = r.json()
        return data if isinstance(data, list) else None
    except (requests.RequestException, ValueError):
        # ValueError couvre un corps 200 non-JSON (garantit le fail-open quelle
        # que soit la version de requests).
        return None


def get_company_config(company_id: int) -> dict | None:
    rows = _get(f"app_rh_company_config?company_id=eq.{company_id}&select=enabled_tabs,active")
    return rows[0] if rows else None


def company_theme_color(company_id: int) -> str | None:
    """Couleur d'accentuation de la société depuis app_rh_company_config. None si absente."""
    rows = _get(f"app_rh_company_config?company_id=eq.{company_id}&select=theme_color")
    if rows and rows[0].get("theme_color"):
        return rows[0]["theme_color"]
    return None


def get_employee_access(hr_employee_id: int) -> dict | None:
    rows = _get(
        f"app_rh_access?hr_employee_id=eq.{hr_employee_id}&select=access_active,allowed_tabs,level"
    )
    return rows[0] if rows else None


def access_decision(hr_employee_id: int, company_id: int) -> dict:
    """Décision d'accès, fail-open.

    Retour : {"allowed": bool, "effective_tabs": list[str], "level": str | None}.
    - Refus (allowed=False) uniquement si la ligne employé existe ET
      access_active is False.
    - Sinon (pas de ligne, réseau KO, conf absente) → allowed=True avec les
      onglets de la société (ou les 5 contrôlables par défaut).
    """
    company = get_company_config(company_id)
    if company is not None and company.get("active") is False:
        # Société désactivée → aucun onglet contrôlable (Accueil/Pointer/Moi
        # restent visibles côté frontend, hors de cette liste).
        company_enabled = []
    else:
        # Pas de config (fail-open) → les 5 contrôlables.
        company_enabled = (company or {}).get("enabled_tabs") or CONTROLLABLE_TABS

    emp = get_employee_access(hr_employee_id)
    if emp is not None and emp.get("access_active") is False:
        return {"allowed": False, "effective_tabs": [], "level": emp.get("level")}

    allowed_tabs = (emp or {}).get("allowed_tabs") or []
    effective = resolve_effective_tabs(allowed_tabs, company_enabled)
    return {"allowed": True, "effective_tabs": effective, "level": (emp or {}).get("level")}
