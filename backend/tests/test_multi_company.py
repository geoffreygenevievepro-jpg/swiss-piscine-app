# backend/tests/test_multi_company.py
from unittest.mock import MagicMock
import app.odoo as odoo


def test_company_domain_param():
    assert odoo._company_domain(7) == [["company_id", "=", 7]]


def test_week_planning_uses_employee_company(monkeypatch):
    captured = {}
    monkeypatch.setattr(odoo, "employee_company_id", lambda hr: 7)
    ro = MagicMock()
    def exec_kw(model, method, args, kw=None):
        captured["domain"] = args[0]
        return []
    ro.execute_kw.side_effect = exec_kw
    monkeypatch.setattr(odoo, "get_client", lambda: ro)
    odoo.week_planning(194, 0)
    # le domaine planning.slot doit contenir la société 7 (pas 5)
    flat = str(captured.get("domain"))
    assert '"company_id"' in flat.replace("'", '"') and "7" in flat
