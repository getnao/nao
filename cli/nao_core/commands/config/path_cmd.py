"""Print the absolute path of the `nao_config.yaml` for the current project."""

from __future__ import annotations

from nao_core.config import resolve_project_path
from nao_core.tracking import track_command
from nao_core.ui import UI


@track_command("config path")
def path_cmd() -> None:
    """Print the absolute path of the `nao_config.yaml` for the current project.

    Exits 0 with the absolute path on stdout when the file is found in the
    current working directory. Exits 1 with a one-line error otherwise.
    """
    project_path = resolve_project_path()
    config_file = project_path / "nao_config.yaml"
    if not config_file.exists():
        UI.error(f"No nao_config.yaml found in {project_path}")
        raise SystemExit(1)

    # Use plain print (not Rich's console.print) so the path stays on one
    # line for shell consumption: `vim "$(nao config path)"`.
    print(str(config_file.resolve()))
