"""Tests for `nao config show`."""

from __future__ import annotations

import json

import pytest

from nao_core.commands.config.show import REDACTED, show


class TestShow:
    def test_prints_minimal_config(self, config_file, capsys):
        config_file("project_name: my-project\n")

        show()

        captured = capsys.readouterr()
        assert "project_name: my-project" in captured.out

    def test_exits_when_config_missing(self, tmp_path, monkeypatch, capsys):
        monkeypatch.chdir(tmp_path)

        with pytest.raises(SystemExit) as exc:
            show()
        assert exc.value.code == 1
        assert "No nao_config.yaml" in capsys.readouterr().out

    def test_exits_on_invalid_yaml(self, config_file, capsys):
        config_file("project_name: [unclosed\n")

        with pytest.raises(SystemExit) as exc:
            show()
        assert exc.value.code == 1
        assert "Failed to load" in capsys.readouterr().out

    def test_exits_on_schema_violation(self, config_file, capsys):
        config_file("project_name: 42\n")  # must be a string

        with pytest.raises(SystemExit) as exc:
            show()
        assert exc.value.code == 1
        assert "Failed to load" in capsys.readouterr().out

    def test_redacts_top_level_api_key(self, config_file, capsys):
        config_file(
            "project_name: my-project\nllm:\n  providers:\n    - provider: openai\n      api_key: sk-super-secret\n"
        )

        show()

        captured = capsys.readouterr()
        assert "sk-super-secret" not in captured.out
        assert REDACTED in captured.out

    def test_redacts_nested_token(self, config_file, capsys):
        config_file("project_name: my-project\nnotion:\n  api_key: secret-notion-key\n  pages:\n    - page-123\n")

        show()

        captured = capsys.readouterr()
        assert "secret-notion-key" not in captured.out
        assert "page-123" in captured.out
        assert REDACTED in captured.out

    def test_redacts_database_password(self, config_file, capsys):
        config_file(
            "project_name: my-project\n"
            "databases:\n"
            "  - type: postgres\n"
            "    name: pg\n"
            "    host: db.example.com\n"
            "    port: 5432\n"
            "    database: app\n"
            "    user: app\n"
            "    password: hunter2\n"
        )

        show()

        captured = capsys.readouterr()
        assert "hunter2" not in captured.out
        assert "db.example.com" in captured.out
        assert REDACTED in captured.out

    def test_show_secrets_keeps_values(self, config_file, capsys):
        config_file("project_name: my-project\nnotion:\n  api_key: secret-notion-key\n  pages:\n    - page-123\n")

        show(show_secrets=True)

        captured = capsys.readouterr()
        assert "secret-notion-key" in captured.out
        assert "warning: --show-secrets" in captured.err

    def test_format_json(self, config_file, capsys):
        config_file("project_name: my-project\n")

        show(format="json")

        captured = capsys.readouterr()
        parsed = json.loads(captured.out)
        assert parsed["project_name"] == "my-project"

    def test_format_json_redacts(self, config_file, capsys):
        config_file("project_name: my-project\nnotion:\n  api_key: secret-key\n  pages:\n    - page-123\n")

        show(format="json")

        captured = capsys.readouterr()
        parsed = json.loads(captured.out)
        assert parsed["notion"]["api_key"] == REDACTED
