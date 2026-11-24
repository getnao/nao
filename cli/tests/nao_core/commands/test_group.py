from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

from nao_core.commands.group import group


def test_group_forwards_arguments_from_current_project(tmp_path: Path, monkeypatch):
    binary = tmp_path / "nao-chat-server"
    binary.touch()
    monkeypatch.chdir(tmp_path)
    with (
        patch("nao_core.commands.group.get_server_binary_path", return_value=binary),
        patch("nao_core.commands.group.subprocess.run") as run,
    ):
        run.return_value = MagicMock(returncode=0)

        group(["format"])

    run.assert_called_once()
    assert run.call_args.args[0] == [
        str(binary),
        "groups",
        "format",
    ]
    assert run.call_args.kwargs["cwd"] == str(tmp_path)


def test_group_propagates_binary_exit_code(tmp_path: Path):
    with (
        patch("nao_core.commands.group.get_server_binary_path", return_value=tmp_path / "nao-chat-server"),
        patch("nao_core.commands.group.subprocess.run", return_value=MagicMock(returncode=1)),
        pytest.raises(SystemExit) as error,
    ):
        group(["lint"])

    assert error.value.code == 1
