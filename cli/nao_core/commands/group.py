import os
import subprocess
from typing import Annotated

from cyclopts import Parameter

from nao_core.commands.chat import get_server_binary_path
from nao_core.tracking import track_command


@track_command("group")
def group(
    args: Annotated[
        list[str],
        Parameter(allow_leading_hyphen=True, help="lint, format or diff arguments."),
    ] = [],
) -> None:
    """Validate, format or diff groups.yaml in the current project."""
    _run(args)


def groups(
    args: Annotated[
        list[str],
        Parameter(allow_leading_hyphen=True, help="lint, format or diff arguments."),
    ] = [],
) -> None:
    """Alias of `nao group`."""
    _run(args)


def _run(args: list[str]) -> None:
    result = subprocess.run(
        [str(get_server_binary_path()), "groups", *args],
        cwd=os.getcwd(),
        env=os.environ.copy(),
        check=False,
    )
    if result.returncode != 0:
        raise SystemExit(result.returncode)
