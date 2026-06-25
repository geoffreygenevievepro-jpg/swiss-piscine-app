"""Tests du gate d'accès Supabase (lecture seule, fail-open)."""
import app.supabase_access as sa


# --- resolve_effective_tabs (logique pure) ---

def test_resolve_allowed_vide_donne_les_onglets_societe():
    assert sa.resolve_effective_tabs([], ["planning", "conges"]) == ["planning", "conges"]


def test_resolve_intersection_societe_plafond():
    # documents pas activé pour la société → exclu
    assert sa.resolve_effective_tabs(["planning", "documents"], ["planning", "conges"]) == ["planning"]


def test_resolve_ignore_cles_inconnues():
    assert sa.resolve_effective_tabs(["planning", "bidon"], ["planning", "conges"]) == ["planning"]


def test_resolve_preserve_ordre_canonique():
    assert sa.resolve_effective_tabs([], ["documents", "terrain"]) == ["terrain", "documents"]


# --- access_decision (fail-open) ---

def _stub(monkeypatch, company, emp):
    monkeypatch.setattr(sa, "get_company_config", lambda cid: company)
    monkeypatch.setattr(sa, "get_employee_access", lambda hid: emp)


def test_decision_ligne_active_filtre_les_onglets(monkeypatch):
    _stub(monkeypatch, {"enabled_tabs": ["terrain", "planning"], "active": True},
          {"access_active": True, "allowed_tabs": ["planning"], "level": "membre"})
    d = sa.access_decision(194, 5)
    assert d["allowed"] is True
    assert d["effective_tabs"] == ["planning"]
    assert d["level"] == "membre"


def test_decision_access_active_false_refuse(monkeypatch):
    _stub(monkeypatch, {"enabled_tabs": ["terrain"], "active": True},
          {"access_active": False, "allowed_tabs": [], "level": "membre"})
    d = sa.access_decision(194, 5)
    assert d["allowed"] is False
    assert d["effective_tabs"] == []


def test_decision_pas_de_ligne_fail_open_tous_onglets_societe(monkeypatch):
    # Employé sans ligne d'accès → on laisse entrer avec les onglets société.
    _stub(monkeypatch, {"enabled_tabs": ["terrain", "conges"], "active": True}, None)
    d = sa.access_decision(999, 5)
    assert d["allowed"] is True
    assert d["effective_tabs"] == ["terrain", "conges"]


def test_decision_societe_desactivee_aucun_onglet(monkeypatch):
    # Société active=false → aucun onglet contrôlable (mais accès non bloqué).
    _stub(monkeypatch, {"enabled_tabs": ["terrain", "planning"], "active": False},
          {"access_active": True, "allowed_tabs": [], "level": "membre"})
    d = sa.access_decision(194, 5)
    assert d["allowed"] is True
    assert d["effective_tabs"] == []


def test_decision_supabase_injoignable_fail_open_5_onglets(monkeypatch):
    # Aucune config (réseau KO simulé par None partout) → fail-open, 5 contrôlables.
    _stub(monkeypatch, None, None)
    d = sa.access_decision(999, 5)
    assert d["allowed"] is True
    assert d["effective_tabs"] == sa.CONTROLLABLE_TABS
