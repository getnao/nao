from pathlib import Path
from unittest.mock import patch

import pytest

from nao_core.commands.chat import chat, get_fastapi_main_path, get_server_binary_path
from nao_core.config.base import NaoConfig

# Tests for try_load with exit_on_error=False (default, silent mode)


def test_try_load_returns_none_when_file_not_found(tmp_path: Path):
    cfg = NaoConfig.try_load(tmp_path)
    assert cfg is None


def test_try_load_returns_none_when_invalid_yaml(tmp_path: Path):
    invalid_yaml = tmp_path / "nao_config.yaml"
    invalid_yaml.write_text("project_name: [invalid yaml")  # Invalid YAML syntax

    cfg = NaoConfig.try_load(tmp_path)
    assert cfg is None


def test_try_load_returns_none_when_validation_error(tmp_path: Path):
    invalid_config = tmp_path / "nao_config.yaml"
    invalid_config.write_text("databases: []")  # Missing required project_name

    cfg = NaoConfig.try_load(tmp_path)
    assert cfg is None


def test_try_load_returns_config_when_valid(tmp_path: Path):
    valid_yaml = tmp_path / "nao_config.yaml"
    valid_yaml.write_text("project_name: test-project")

    cfg = NaoConfig.try_load(tmp_path)

    assert cfg is not None
    assert isinstance(cfg, NaoConfig)
    assert cfg.project_name == "test-project"


# Tests for try_load with exit_on_error=True


def test_try_load_exits_on_file_not_found(tmp_path: Path):
    with patch("nao_core.config.base.Console") as mock_console_cls:
        mock_console = mock_console_cls.return_value
        with pytest.raises(SystemExit) as exc_info:
            NaoConfig.try_load(tmp_path, exit_on_error=True)

        assert exc_info.value.code == 1
        mock_console.print.assert_any_call("[bold red]✗[/bold red] No nao_config.yaml found in current directory")


def test_try_load_exits_on_invalid_yaml(tmp_path: Path):
    invalid_yaml = tmp_path / "nao_config.yaml"
    invalid_yaml.write_text("project_name: [invalid yaml")

    with patch("nao_core.config.base.Console") as mock_console_cls:
        mock_console = mock_console_cls.return_value
        with pytest.raises(SystemExit) as exc_info:
            NaoConfig.try_load(tmp_path, exit_on_error=True)

        assert exc_info.value.code == 1
        mock_console.print.assert_any_call("[bold red]✗[/bold red] Failed to load nao_config.yaml:")


def test_try_load_exits_on_validation_error(tmp_path: Path):
    invalid_config = tmp_path / "nao_config.yaml"
    invalid_config.write_text("databases: []")  # Missing required project_name

    with patch("nao_core.config.base.Console") as mock_console_cls:
        mock_console = mock_console_cls.return_value
        with pytest.raises(SystemExit) as exc_info:
            NaoConfig.try_load(tmp_path, exit_on_error=True)

        assert exc_info.value.code == 1
        mock_console.print.assert_any_call("[bold red]✗[/bold red] Failed to load nao_config.yaml:")


# Integration test for chat command


def test_chat_exits_when_no_config_found(tmp_path: Path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    monkeypatch.delenv("NAO_DEFAULT_PROJECT_PATH", raising=False)

    with patch("nao_core.config.base.Console"):
        with pytest.raises(SystemExit) as exc_info:
            chat()

        assert exc_info.value.code == 1


def test_get_server_binary_path():
    """Test that get_server_binary_path returns the expected path structure."""
    with patch.object(Path, "exists", return_value=True):
        result_path = get_server_binary_path()

    assert result_path.name == "nao-chat-server"
    assert result_path.parent.name == "bin"


def test_get_server_binary_path_does_not_exists():
    """Exit when the server binary does not exist."""
    with patch("nao_core.commands.chat.Path.exists", return_value=False):
        with pytest.raises(SystemExit) as exc_info:
            get_server_binary_path()

    assert exc_info.value.code == 1
    assert exc_info.type is SystemExit


def test_get_fastapi_main_path():
    """Test that get_fastapi_main_path returns the expected path structure."""
    with patch.object(Path, "exists", return_value=True):
        result_path = get_fastapi_main_path()

    assert result_path.name == "main.py"
    assert result_path.parent.name == "fastapi"


def test_get_fastapi_main_path_does_not_exists():
    """Exit when the FastAPI main.py does not exist."""
    with patch("nao_core.commands.chat.Path.exists", return_value=False):
        with pytest.raises(SystemExit) as exc_info:
            get_fastapi_main_path()

    assert exc_info.value.code == 1
    assert exc_info.type is SystemExit
