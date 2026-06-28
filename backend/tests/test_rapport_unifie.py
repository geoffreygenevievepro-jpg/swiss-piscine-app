"""Backend du rapport unifié (company-aware) : /resources, facture depuis un
rapport de planning, resource_id + parts + remarques sur création, Remarques worksheet."""
from unittest.mock import MagicMock

from fastapi.testclient import TestClient
import app.odoo as odoo
from app.main import app
from app.deps import get_current_employee

client = TestClient(app)


# --- T1 : list_resources + GET /resources (scopé société) ------------------
def test_list_resources_scoped_company(monkeypatch):
    ro = MagicMock()
    ro.execute_kw.return_value = [
        {"id": 7, "name": "Alex", "employee_id": [3, "Alex"]},
        {"id": 8, "name": "Loïc", "employee_id": False},
    ]
    monkeypatch.setattr(odoo, "get_client", lambda: ro)
    out = odoo.list_resources(5)
    assert out == [
        {"resource_id": 7, "employee_id": 3, "name": "Alex"},
        {"resource_id": 8, "employee_id": None, "name": "Loïc"},
    ]
    # la société est bien dans le domaine de recherche
    domain = ro.execute_kw.call_args.args[2][0]
    assert ["company_id", "=", 5] in domain


def test_resources_endpoint_uses_employee_company(monkeypatch):
    monkeypatch.setattr(odoo, "list_resources",
                        lambda cid: [{"resource_id": 7, "employee_id": 3, "name": "Alex"}] if cid == 5 else [])
    app.dependency_overrides[get_current_employee] = lambda: {"hr_employee_id": 3, "name": "Alex", "company_id": 5}
    r = client.get("/resources")
    app.dependency_overrides.clear()
    assert r.status_code == 200
    assert r.json() == [{"resource_id": 7, "employee_id": 3, "name": "Alex"}]


# --- T2 : submit_report facture les lignes (company-aware) ------------------
def _slot_rows():
    return [{"task_id": False, "project_id": False, "partner_id": [42, "Client"],
             "name": "Chantier X", "start_datetime": "2026-06-27 06:00:00", "employee_ids": []}]


def test_submit_report_invoices_with_company(monkeypatch):
    ro = MagicMock(); ro.execute_kw.return_value = _slot_rows()
    rw = MagicMock()
    monkeypatch.setattr(odoo, "employee_company_id", lambda hr: 5)
    monkeypatch.setattr(odoo, "get_client", lambda: ro)
    monkeypatch.setattr(odoo, "get_write_client", lambda: rw)
    monkeypatch.setattr(odoo, "_fill_worksheet", lambda *a, **k: None)
    seen = {}

    def fake_inv(partner_id, products, discount=0.0, origin=None, company_id=None):
        seen.update(partner_id=partner_id, products=products, company_id=company_id)
        return 999

    monkeypatch.setattr(odoo, "create_draft_invoice", fake_inv)
    report = {"type": "Entretien", "discount": 0,
              "products": [{"name": "Filtre", "qty": 1, "price": 80.0, "billable": True}]}
    res = odoo.submit_report(1, "Alex", 5, report)
    assert res["invoice"] is True and res["invoice_id"] == 999
    assert seen["company_id"] == 5 and seen["partner_id"] == 42
    assert [p["name"] for p in seen["products"]] == ["Filtre"]


def test_submit_report_no_invoice_without_products(monkeypatch):
    ro = MagicMock(); ro.execute_kw.return_value = _slot_rows()
    monkeypatch.setattr(odoo, "employee_company_id", lambda hr: 5)
    monkeypatch.setattr(odoo, "get_client", lambda: ro)
    monkeypatch.setattr(odoo, "get_write_client", lambda: MagicMock())
    monkeypatch.setattr(odoo, "_fill_worksheet", lambda *a, **k: None)
    monkeypatch.setattr(odoo, "create_draft_invoice",
                        lambda *a, **k: (_ for _ in ()).throw(AssertionError("ne doit pas facturer")))
    res = odoo.submit_report(1, "Alex", 5, {"type": "Entretien", "products": []})
    assert res["invoice"] is False and res["invoice_id"] is None


def test_submit_report_assigns_resources(monkeypatch):
    ro = MagicMock()
    ro.execute_kw.side_effect = [
        _slot_rows(),                                                   # 1) slot search_read
        [{"name": "Claudio", "resource_id": [424, "C"]},               # 2) hr.employee read
         {"name": "Loïc", "resource_id": [426, "L"]}],
    ]
    rw = MagicMock()
    monkeypatch.setattr(odoo, "employee_company_id", lambda hr: 5)
    monkeypatch.setattr(odoo, "get_client", lambda: ro)
    monkeypatch.setattr(odoo, "get_write_client", lambda: rw)
    monkeypatch.setattr(odoo, "_fill_worksheet", lambda *a, **k: None)
    odoo.submit_report(1, "Alex", 5, {"type": "E", "worker_ids": [178, 180], "products": []})
    res_writes = [c for c in rw.execute_kw.call_args_list
                  if c.args[0] == "planning.slot" and c.args[1] == "write"
                  and "resource_ids" in c.args[2][1]]
    assert res_writes, "submit_report doit assigner l'équipe via resource_ids"
    assert res_writes[0].args[2][1]["resource_ids"] == [(6, 0, [424, 426])]


# --- T3 : worksheet Remarques + create_intervention resource/parts/billing -
def test_fill_worksheet_maps_remarques(monkeypatch):
    rw = MagicMock(); ro = MagicMock()
    monkeypatch.setattr(odoo, "_intervention_ws_template_id", lambda ro_: 10)
    ro.execute_kw.return_value = [{"worksheet_properties": [
        {"string": "Remarques", "type": "text", "value": False},
        {"string": "Type d'intervention", "type": "char", "value": False},
    ]}]
    odoo._fill_worksheet(ro, rw, 5, {"start_datetime": False, "partner_id": False},
                         {"remarques": "RAS tout ok", "type": "Entretien"})
    vals = rw.execute_kw.call_args_list[-1].args[2][1]
    rem = next(p for p in vals["worksheet_properties"] if p["string"] == "Remarques")
    assert rem["value"] == "RAS tout ok"


def test_create_intervention_resource_parts_remarques_billing(monkeypatch):
    rw = MagicMock(); rw.execute_kw.return_value = 100
    ro = MagicMock(); ro.execute_kw.return_value = [{"name": "Alex", "resource_id": [99, "Alex"]}]
    monkeypatch.setattr(odoo, "employee_company_id", lambda hr: 5)
    monkeypatch.setattr(odoo, "get_write_client", lambda: rw)
    monkeypatch.setattr(odoo, "get_client", lambda: ro)
    cap = {}
    monkeypatch.setattr(odoo, "_fill_worksheet", lambda ro_, rw_, sid, sctx, rep: cap.update(report_like=rep))
    inv = {}
    monkeypatch.setattr(odoo, "create_draft_invoice",
                        lambda p, prods, disc, origin=None, company_id=None: inv.update(p=p, cid=company_id) or 777)
    res = odoo.create_intervention(
        1, "desc", "2026-06-27 06:00:00", "2026-06-27 08:00:00",
        partner_id=42, type_label="Entretien",
        products=[{"name": "Filtre", "qty": 1, "price": 80.0, "billable": True}],
        parts=["Filtre", "Vis"], resource_ids=[7], remarques="RAS")
    create_vals = rw.execute_kw.call_args_list[0].args[2][0]
    # planning.slot.employee_ids est CALCULÉ → on n'écrit ni resource_id ni employee_ids.
    assert "resource_id" not in create_vals
    assert "employee_ids" not in create_vals
    # L'équipe est assignée via resource_ids (résolu depuis worker_ids/hr_employee_id).
    assert create_vals["resource_ids"] == [(6, 0, [99])]
    assert res["invoice"] is True and res["invoice_id"] == 777
    assert inv["cid"] == 5 and inv["p"] == 42
    assert cap["report_like"]["parts"] == ["Filtre", "Vis"]
    assert cap["report_like"]["remarques"] == "RAS"


# --- #2 : Projet / Tâche ---------------------------------------------------
def test_search_projects_scoped(monkeypatch):
    ro = MagicMock()
    ro.execute_kw.return_value = [{"id": 107, "name": "Mario Constante", "partner_id": [42, "Mario"]}]
    monkeypatch.setattr(odoo, "get_client", lambda: ro)
    out = odoo.search_projects("mario", 5)
    assert out == [{"id": 107, "name": "Mario Constante", "partner_id": 42, "partner_name": "Mario"}]
    domain = ro.execute_kw.call_args.args[2][0]
    assert ["company_id", "=", 5] in domain


def test_create_intervention_writes_project_task(monkeypatch):
    rw = MagicMock(); rw.execute_kw.return_value = 100
    ro = MagicMock(); ro.execute_kw.return_value = [{"name": "Alex", "resource_id": [99, "Alex"]}]
    monkeypatch.setattr(odoo, "employee_company_id", lambda hr: 5)
    monkeypatch.setattr(odoo, "get_write_client", lambda: rw)
    monkeypatch.setattr(odoo, "get_client", lambda: ro)
    monkeypatch.setattr(odoo, "_fill_worksheet", lambda *a, **k: None)
    odoo.create_intervention(1, "d", "2026-06-28 06:00:00", "2026-06-28 08:00:00",
                             type_label="E", project_id=107, task_id=4899)
    create_vals = rw.execute_kw.call_args_list[0].args[2][0]
    assert create_vals["project_id"] == 107 and create_vals["task_id"] == 4899


def test_submit_report_links_project_task(monkeypatch):
    ro = MagicMock(); ro.execute_kw.return_value = _slot_rows()
    rw = MagicMock()
    monkeypatch.setattr(odoo, "employee_company_id", lambda hr: 5)
    monkeypatch.setattr(odoo, "get_client", lambda: ro)
    monkeypatch.setattr(odoo, "get_write_client", lambda: rw)
    monkeypatch.setattr(odoo, "_fill_worksheet", lambda *a, **k: None)
    odoo.submit_report(1, "Alex", 5, {"type": "E", "project_id": 107, "task_id": 4899, "products": []})
    link = [c for c in rw.execute_kw.call_args_list
            if c.args[0] == "planning.slot" and c.args[1] == "write" and "project_id" in c.args[2][1]]
    assert link and link[0].args[2][1] == {"project_id": 107, "task_id": 4899}
