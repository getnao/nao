from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

from nao_core.commands.reset_password import reset_password


def _fake_binary(tmp_path: Path) -> Path:
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    binary = bin_dir / "nao-chat-server"
    binary.touch()
    return binary


@patch("nao_core.commands.reset_password.subprocess.run")
@patch("nao_core.commands.reset_password.get_server_binary_path")
def test_reset_password_invokes_binary(mock_binary_path, mock_run, tmp_path: Path):
    binary = _fake_binary(tmp_path)
    mock_binary_path.return_value = binary
    mock_run.return_value = MagicMock(returncode=0)

    reset_password("user@example.com")

    mock_run.assert_called_once()
    args, kwargs = mock_run.call_args
    assert args[0] == [str(binary), "reset-password", "--email", "user@example.com"]
    assert kwargs["cwd"] == str(binary.parent)


@patch("nao_core.commands.reset_password.subprocess.run")
@patch("nao_core.commands.reset_password.get_server_binary_path")
def test_reset_password_propagates_binary_failure(mock_binary_path, mock_run, tmp_path: Path):
    binary = _fake_binary(tmp_path)
    mock_binary_path.return_value = binary
    mock_run.return_value = MagicMock(returncode=1)

    with pytest.raises(SystemExit) as exc_info:
        reset_password("user@example.com")

    assert exc_info.value.code == 1
