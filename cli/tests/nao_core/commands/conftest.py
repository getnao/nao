from unittest.mock import MagicMock, patch

import pytest


@pytest.fixture
def clean_env(monkeypatch):
    """Remove environment variables that interfere with chat command tests."""
    monkeypatch.delenv("BETTER_AUTH_SECRET", raising=False)
    monkeypatch.delenv("NAO_DEFAULT_PROJECT_PATH", raising=False)


@pytest.fixture
def create_config(tmp_path, monkeypatch):
    """Factory fixture to create a nao config file and chdir to tmp_path."""

    def _create(content: str = "project_name: test-project\n"):
        config_file = tmp_path / "nao_config.yaml"
        config_file.write_text(content)
        monkeypatch.chdir(tmp_path)
        return config_file

    return _create


@pytest.fixture
def mock_socket():
    mock_sock = MagicMock()
    with patch("socket.socket") as mock_socket_cls:
        mock_socket_cls.return_value.__enter__.return_value = mock_sock
        with patch("nao_core.commands.chat.sleep"):
            yield mock_sock


@pytest.fixture
def mock_chat_dependencies(tmp_path, create_config, clean_env):
    """Set up valid config and fake binary paths."""
    create_config()
    # Create fake binaries that pass the exists() check
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    (bin_dir / "nao-chat-server").touch()
    fastapi_dir = bin_dir / "fastapi"
    fastapi_dir.mkdir()
    (fastapi_dir / "main.py").touch()

    return tmp_path, bin_dir
