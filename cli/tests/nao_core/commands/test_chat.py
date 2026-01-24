from pathlib import Path
from unittest.mock import patch

import pytest

from nao_core.commands.chat import chat
from nao_core.config.base import NaoConfig


def test_returns_none_when_nao_config_file_does_not_exist(tmp_path: Path):
    missing_file = tmp_path / "missing.yaml"
    cfg = NaoConfig.try_load(missing_file)

    assert cfg is None


def test_returns_config_when_nao_config_file_is_valid(tmp_path: Path):
    valid_yaml = tmp_path / "nao_config.yaml"
    valid_yaml.write_text(
        """
        project_name: nao
        """
    )
    cfg = NaoConfig.try_load(tmp_path)

    assert cfg is not None
    assert isinstance(cfg, NaoConfig)


def test_chat_exits_when_no_config_found(tmp_path: Path, monkeypatch):
    monkeypatch.chdir(tmp_path)

    with patch("nao_core.commands.chat.console") as mock_console:
        with pytest.raises(SystemExit) as exc_info:
            chat()

        assert exc_info.value.code == 1
        mock_console.print.assert_any_call(
            "[bold red]✗No nao_config.yaml found in current directory. Please move to a nao project directory.[/bold red]"
        )
