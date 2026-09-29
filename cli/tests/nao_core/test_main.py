import json
import sys
from unittest.mock import Mock

import pytest

import nao_core.main as main_module


def test_parser_errors_use_json_without_update_warning(monkeypatch, capsys):
    check_for_updates = Mock(side_effect=lambda: print("Update available"))
    monkeypatch.setattr(sys, "argv", ["nao", "migrate", "metabase", "dashboard", "--json"])
    monkeypatch.setattr(main_module, "check_for_updates", check_for_updates)

    with pytest.raises(SystemExit):
        main_module.main()

    check_for_updates.assert_not_called()
    captured = capsys.readouterr()
    error = json.loads(captured.out)
    assert error["success"] is False
    assert "sources" in error["error"].lower()
    assert captured.err == ""


def test_json_only_changes_error_handling_for_metabase_commands(monkeypatch):
    app = Mock()
    check_for_updates = Mock()
    monkeypatch.setattr(sys, "argv", ["nao", "sync", "--json"])
    monkeypatch.setattr(main_module, "app", app)
    monkeypatch.setattr(main_module, "check_for_updates", check_for_updates)

    main_module.main()

    check_for_updates.assert_called_once_with()
    app.assert_called_once_with()
