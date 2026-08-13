"""Tests for `nao config path`."""

from __future__ import annotations

import pytest

from nao_core.commands.config.path_cmd import path_cmd


class TestPath:
    def test_prints_absolute_path(self, config_file, capsys):
        path = config_file("project_name: my-project\n")

        path_cmd()

        captured = capsys.readouterr()
        assert captured.out.strip() == str(path.resolve())

    def test_exits_when_missing(self, tmp_path, monkeypatch, capsys):
        monkeypatch.chdir(tmp_path)

        with pytest.raises(SystemExit) as exc:
            path_cmd()
        assert exc.value.code == 1
        assert "No nao_config.yaml" in capsys.readouterr().out
