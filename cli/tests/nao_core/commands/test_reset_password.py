from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

from nao_core.commands.reset_password import reset_password


@pytest.fixture
def binary(tmp_path: Path):
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    binary = bin_dir / "nao-chat-server"
    binary.touch()
    with patch("nao_core.commands.reset_password.get_server_binary_path", return_value=binary):
        yield binary


@pytest.fixture
def mock_run():
    with patch("nao_core.commands.reset_password.subprocess.run") as run:
        yield run


def test_reset_password_invokes_binary(binary: Path, mock_run):
    mock_run.return_value = MagicMock(returncode=0)

    reset_password("user@example.com")

    mock_run.assert_called_once()
    args, kwargs = mock_run.call_args
    assert args[0] == [str(binary), "reset-password", "--email", "user@example.com"]
    assert kwargs["cwd"] == str(binary.parent)


@pytest.mark.usefixtures("binary")
def test_reset_password_propagates_binary_failure(mock_run):
    mock_run.return_value = MagicMock(returncode=1)

    with pytest.raises(SystemExit) as exc_info:
        reset_password("user@example.com")

    assert exc_info.value.code == 1
