"""Tests for `nao config validate`."""

from __future__ import annotations

import pytest

from nao_core.commands.config.validate import validate


class TestValidate:
    def test_exits_zero_on_valid_config(self, config_file, capsys):
        config_file("project_name: my-project\n")

        with pytest.raises(SystemExit) as exc:
            validate()
        assert exc.value.code == 0
        assert "is valid" in capsys.readouterr().out

    def test_exits_one_on_missing_file(self, tmp_path, monkeypatch, capsys):
        monkeypatch.chdir(tmp_path)

        with pytest.raises(SystemExit) as exc:
            validate()
        assert exc.value.code == 1
        assert "No nao_config.yaml" in capsys.readouterr().out

    def test_exits_one_on_invalid_yaml(self, config_file, capsys):
        config_file("project_name: [unclosed\n")

        with pytest.raises(SystemExit) as exc:
            validate()
        assert exc.value.code == 1

    def test_exits_one_on_schema_violation(self, config_file, capsys):
        config_file("project_name: 42\n")  # must be a string

        with pytest.raises(SystemExit) as exc:
            validate()
        assert exc.value.code == 1
        assert "Failed to load" in capsys.readouterr().out
