from unittest.mock import MagicMock, patch

import pytest


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
