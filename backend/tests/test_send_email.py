from unittest.mock import MagicMock
import app.odoo as odoo


def test_send_email_creates_and_sends(monkeypatch):
    rw = MagicMock()
    rw.execute_kw.return_value = 42  # id du mail.mail créé
    monkeypatch.setattr(odoo, "get_write_client", lambda: rw)
    ok = odoo.send_email("a@b.ch", "Sujet", "<p>hi</p>")
    assert ok is True
    models = [c.args[0] for c in rw.execute_kw.call_args_list]
    assert "mail.mail" in models


def test_send_email_best_effort(monkeypatch):
    rw = MagicMock()
    rw.execute_kw.side_effect = RuntimeError("odoo down")
    monkeypatch.setattr(odoo, "get_write_client", lambda: rw)
    assert odoo.send_email("a@b.ch", "S", "B") is False
