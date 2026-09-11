from unittest.mock import Mock

import pytest

import nao_core.main as main_module
from nao_core.commands.migration_client import MigrationError


def test_main_prints_migration_errors_without_traceback(monkeypatch):
    app = Mock(side_effect=MigrationError("Request failed"))
    error = Mock()
    monkeypatch.setattr(main_module, "app", app)
    monkeypatch.setattr(main_module, "check_for_updates", Mock())
    monkeypatch.setattr(main_module.UI, "error", error)
    monkeypatch.setattr(main_module.sys, "argv", ["nao", "metabase"])

    with pytest.raises(SystemExit) as exit_error:
        main_module.main()

    assert exit_error.value.code == 1
    error.assert_called_once_with("Request failed")


def test_main_keeps_json_output_machine_readable(monkeypatch):
    app = Mock()
    check_for_updates = Mock()
    monkeypatch.setattr(main_module, "app", app)
    monkeypatch.setattr(main_module, "check_for_updates", check_for_updates)
    monkeypatch.setattr(main_module.sys, "argv", ["nao", "metabase", "collections", "--json"])

    main_module.main()

    app.assert_called_once_with()
    check_for_updates.assert_not_called()


def test_main_sends_json_mode_errors_to_stderr(monkeypatch, capsys):
    monkeypatch.setattr(main_module, "app", Mock(side_effect=MigrationError("Request failed")))
    monkeypatch.setattr(main_module, "check_for_updates", Mock())
    monkeypatch.setattr(main_module.sys, "argv", ["nao", "stories", "folders", "--json"])

    with pytest.raises(SystemExit):
        main_module.main()

    output = capsys.readouterr()
    assert output.out == ""
    assert output.err == "Request failed\n"
