"""nao skills — thin wrapper around the `npx skills` CLI.

Forwards all arguments to `npx skills` (https://github.com/vercel-labs/skills)
so users get a single, familiar entry point while we stay out of the way of
the upstream tool's lifecycle and feature set.
"""

from __future__ import annotations

import shutil
import subprocess
from typing import Annotated

from cyclopts import Parameter

from nao_core.tracking import track_command
from nao_core.ui import UI

NAO_SKILLS_SOURCE = "getnao/nao"


@track_command("skills")
def skills(
    args: Annotated[
        list[str],
        Parameter(allow_leading_hyphen=True, help="Arguments forwarded to `npx skills`."),
    ] = [],
) -> None:
    """Install and manage agent skills via `npx skills`.

    Thin wrapper around the open `skills` CLI from Vercel Labs
    (https://github.com/vercel-labs/skills). Every token after `nao skills`
    is forwarded as-is, so any `npx skills` subcommand and flag works here.

    Examples
    --------
    nao skills                        # show `npx skills` help
    nao skills add getnao/nao         # install nao's published skills
    nao skills list                   # list installed skills
    nao skills update                 # update installed skills
    nao skills remove                 # remove an installed skill
    """
    if shutil.which("npx") is None:
        UI.error("`npx` was not found on your PATH.")
        UI.print("[dim]Install Node.js 18+ (https://nodejs.org/) to use `nao skills`.[/dim]")
        raise SystemExit(1)

    _run_npx_skills(args)


def _run_npx_skills(args: list[str]) -> None:
    """Forward `args` to `npx skills`, propagating its exit code."""
    cmd = ["npx", "--yes", "skills", *args]
    try:
        result = subprocess.run(cmd, check=False)
    except KeyboardInterrupt as e:
        raise SystemExit(130) from e
    except FileNotFoundError as e:
        UI.error("Failed to launch `npx`. Make sure Node.js 18+ is installed.")
        raise SystemExit(1) from e

    if result.returncode != 0:
        raise SystemExit(result.returncode)
