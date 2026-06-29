"""Annuaire contacts + devis/factures : gating de rôle + transmission société."""
from fastapi.testclient import TestClient

from app import odoo
from app.main import app
from app.deps import get_current_employee

client = TestClient(app)


def emp(role, company_id=5):
    return {"id": 1, "login": "u", "name": "U", "role": role,
            "hr_employee_id": 42, "pin_hash": "h", "company_id": company_id}


def teardown_function():
    app.dependency_overrides.clear()


def test_contacts_visible_for_all_roles(monkeypatch):
    app.dependency_overrides[get_current_employee] = lambda: emp("tech")
    monkeypatch.setattr(odoo, "list_contacts", lambda cid, q=None: [{"id": 1, "name": "Client X", "phone": "079", "email": "", "street": "", "zip": "", "city": "Sion", "function": "", "company": "", "is_company": False}])
    r = client.get("/contacts")
    assert r.status_code == 200
    assert r.json()[0]["name"] == "Client X"


def test_sales_docs_forbidden_for_tech(monkeypatch):
    called = {"n": 0}
    app.dependency_overrides[get_current_employee] = lambda: emp("tech")
    monkeypatch.setattr(odoo, "list_sale_documents", lambda *a, **k: called.__setitem__("n", called["n"] + 1) or [])
    r = client.get("/sales-docs?kind=facture")
    assert r.status_code == 403
    assert called["n"] == 0   # Odoo jamais interrogé pour un technicien


def test_sales_docs_allowed_for_office(monkeypatch):
    app.dependency_overrides[get_current_employee] = lambda: emp("office")
    monkeypatch.setattr(odoo, "list_sale_documents",
                        lambda cid, kind, q=None: [{"id": 9, "name": "00354", "partner": "P", "amount": 10.0, "date": "2026-06-01", "state": "Devis envoyé", "has_pdf": True}])
    r = client.get("/sales-docs?kind=devis")
    assert r.status_code == 200 and r.json()[0]["name"] == "00354"


def test_sales_docs_bad_kind(monkeypatch):
    app.dependency_overrides[get_current_employee] = lambda: emp("admin")
    r = client.get("/sales-docs?kind=bidon")
    assert r.status_code == 404


def test_pdf_unavailable_when_absent(monkeypatch):
    app.dependency_overrides[get_current_employee] = lambda: emp("manager")
    monkeypatch.setattr(odoo, "sale_document_pdf", lambda cid, kind, doc_id: None)
    r = client.get("/sales-docs/devis/123/pdf")
    assert r.status_code == 200 and r.json() == {"available": False}


def test_pdf_available(monkeypatch):
    app.dependency_overrides[get_current_employee] = lambda: emp("admin")
    monkeypatch.setattr(odoo, "sale_document_pdf", lambda cid, kind, doc_id: {"b64": "QUJD", "filename": "devis.pdf"})
    r = client.get("/sales-docs/facture/55/pdf")
    assert r.status_code == 200 and r.json()["available"] and r.json()["datas"] == "QUJD"


# --- Détection d'anomalies de contrat ---
def test_contract_issue_rate_mismatch():
    from app import odoo
    cal_h = {10: 42.0}  # même calendrier 100% sur 2 périodes, salaire ×2
    vers = [
        {"date_start": "2026-01-05", "resource_calendar_id": [10, "100%"], "wage": 2692.0},
        {"date_start": "2026-01-19", "resource_calendar_id": [10, "100%"], "wage": 5384.0},
    ]
    iss = odoo._contract_issues(vers, cal_h)
    assert len(iss) == 1 and "taux d'activité à corriger" in iss[0]


def test_contract_issue_clean_when_calendar_follows():
    from app import odoo
    cal_h = {10: 21.0, 20: 42.0}  # 50% puis 100% : calendrier suit → OK
    vers = [
        {"date_start": "2026-01-05", "resource_calendar_id": [10, "50%"], "wage": 2692.0},
        {"date_start": "2026-01-19", "resource_calendar_id": [20, "100%"], "wage": 5384.0},
    ]
    assert odoo._contract_issues(vers, cal_h) == []


def test_contract_issue_missing_calendar():
    from app import odoo
    vers = [{"date_start": "2026-01-05", "resource_calendar_id": False, "wage": 3000.0}]
    iss = odoo._contract_issues(vers, {})
    assert len(iss) == 1 and "sans calendrier" in iss[0]
