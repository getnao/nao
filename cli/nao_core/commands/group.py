import os
import subprocess
import sys
from pathlib import Path
from typing import Annotated

from cyclopts import App, Parameter

from nao_core.commands.chat import get_server_binary_path
from nao_core.tracking import track_command

group = App(name="group", help="Check, format and diff groups.yaml.")

PathOption = Annotated[
    Path | None,
    Parameter(help="Project directory (defaults to current directory)", name=["--path", "-p"]),
]


@group.command
@track_command("group lint")
def lint(path: PathOption = None) -> None:
    """Validate groups.yaml against the local project, without a server."""
    _run_groups_command("lint", path)


@group.command(name="format")
@track_command("group format")
def format_groups(
    path: PathOption = None,
    check: Annotated[bool, Parameter(help="Fail instead of rewriting an unformatted file")] = False,
) -> None:
    """Rewrite groups.yaml with the standard key order and indentation."""
    _run_groups_command("format", path, ["--check"] if check else [])


@group.command
@track_command("group diff")
def diff(
    path: PathOption = None,
    ref: Annotated[str, Parameter(help="Git commit, branch or tag to compare against")] = "HEAD",
    exit_code: Annotated[bool, Parameter(help="Exit with 1 when groups.yaml has changes")] = False,
) -> None:
    """Show what changed in groups.yaml since a Git commit, after resolving inheritance."""
    _run_groups_command("diff", path, ["--ref", ref, *(["--exit-code"] if exit_code else [])])


def _run_groups_command(subcommand: str, path: Path | None, extra_args: list[str] | None = None) -> None:
    project_path = (path or Path.cwd()).resolve()
    result = subprocess.run(
        [str(get_server_binary_path()), "groups", subcommand, "--path", str(project_path), *(extra_args or [])],
        env={**os.environ, "DB_URI": "sqlite::memory:"},
    )
    if result.returncode != 0:
        sys.exit(result.returncode)
