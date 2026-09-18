import json
import sys
from unittest.mock import patch

import pytest

import nao_core.main as main_module


def test_load_project_dotenv_does_not_use_ancestor_env(tmp_path, monkeypatch):
    (tmp_path / ".env").write_text("METABASE_URL=https://wrong.example.com\n")
    project_path = tmp_path / "project"
    nested_path = project_path / "nested"
    nested_path.mkdir(parents=True)
    (project_path / "nao_config.yaml").touch()
    monkeypatch.chdir(nested_path)

    with patch.object(main_module, "load_dotenv") as load_dotenv:
        main_module._load_project_dotenv()

    load_dotenv.assert_called_once_with(project_path / ".env")


def test_parser_errors_use_json_when_requested(monkeypatch, capsys):
    monkeypatch.setattr(sys, "argv", ["nao", "import", "metabase", "dashboard", "--json"])

    with pytest.raises(SystemExit):
        main_module.main()

    captured = capsys.readouterr()
    error = json.loads(captured.out)
    assert error["success"] is False
    assert "requires an argument" in error["error"]
    assert captured.err == ""
