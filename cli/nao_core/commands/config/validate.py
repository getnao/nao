"""Validate `nao_config.yaml` without running anything.

Loads the config (which resolves every secret reference and runs the full
Pydantic schema), prints a one-line success message on green, and exits 0.
On any failure, prints the errors in the same shape `nao debug` and
`nao sync` already use, and exits 1.
"""

from __future__ import annotations

from typing import NoReturn

from nao_core.config import NaoConfig, NaoConfigError, resolve_project_path
from nao_core.tracking import track_command
from nao_core.ui import UI


@track_command("config validate")
def validate() -> NoReturn:
    """Validate `nao_config.yaml` for the current project.

    Reads the file, resolves every secret reference, and runs the full
    Pydantic schema. No side effects, no DB calls, no LLM calls. Exits 0
    on success, 1 on any parse / validation / missing-secret error.
    """
    project_path = resolve_project_path()
    config_file = project_path / "nao_config.yaml"
    if not config_file.exists():
        UI.error(f"No nao_config.yaml found in {project_path}")
        raise SystemExit(1)

    try:
        config = NaoConfig.try_load(project_path, raise_on_error=True)
    except NaoConfigError as error:
        UI.error(str(error))
        raise SystemExit(1) from error

    if config is None:
        UI.error(f"Failed to load {config_file}")
        raise SystemExit(1)

    UI.success(f"{config_file} is valid")
    raise SystemExit(0)
