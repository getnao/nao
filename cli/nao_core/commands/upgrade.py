from __future__ import annotations

import shutil
import subprocess
import sys
from typing import Annotated

from cyclopts import Parameter

from nao_core import __version__
from nao_core.ui import UI, ask_confirm
from nao_core.version import (
    PACKAGE_NAME,
    clear_version_cache,
    get_installed_extras,
    get_latest_version,
    parse_version,
)


def _resolve_install_spec(
    cli_extras: str | None,
) -> tuple[str, set[str] | None]:
    """Pick the package spec to install and report the source.

    Returns:
        (package_spec, detected_extras_or_none)

        package_spec is the literal argument to pass to pip (e.g. ``"nao-core"``
        or ``"nao-core[postgres,openai]"``). detected_extras_or_none is the set
        of extras inferred from the live install, or None when detection
        failed (so the caller can show a follow-up warning).
    """
    if cli_extras is not None:
        extras_list = [e.strip() for e in cli_extras.split(",") if e.strip()]
        if extras_list:
            return f"{PACKAGE_NAME}[{','.join(sorted(extras_list))}]", set(extras_list)
        return PACKAGE_NAME, set()

    detected = get_installed_extras()
    if detected is None:
        return PACKAGE_NAME, None
    if not detected:
        return PACKAGE_NAME, set()
    return f"{PACKAGE_NAME}[{','.join(sorted(detected))}]", detected


def upgrade(
    extras: Annotated[
        str | None,
        Parameter(
            name=["--extras"],
            help=(
                "Comma-separated extras to install (e.g. 'postgres,openai'). "
                "Overrides auto-detection. Pass an empty string to upgrade the "
                "base package only."
            ),
        ),
    ] = None,
) -> None:
    """Upgrade nao-core to the latest version."""

    clear_version_cache()

    UI.info("\nChecking for updates...\n")

    current_version = __version__
    UI.print(f"Current version: {current_version}")

    latest_version = get_latest_version()
    if latest_version is None:
        UI.error("Failed to check for updates. Please try again later.")
        return

    UI.print(f"Latest version: {latest_version}")

    if parse_version(current_version) >= parse_version(latest_version):
        UI.success("\nYou are already on the latest version!")
        return

    package_spec, detected_extras = _resolve_install_spec(extras)
    extras_label = ",".join(sorted(detected_extras)) if detected_extras else "(none)"

    if not ask_confirm(
        f"\nUpgrade {package_spec} from {current_version} to {latest_version}?",
        default=True,
    ):
        UI.print("Upgrade cancelled.")
        return

    UI.print(f"\nUpgrading {package_spec} {current_version} -> {latest_version}...\n")
    UI.print(f"[dim]Detected extras: {extras_label}[/dim]")

    if shutil.which("uv"):
        cmd = ["uv", "pip", "install", "--upgrade", package_spec]
    else:
        cmd = [sys.executable, "-m", "pip", "install", "--upgrade", package_spec]

    try:
        subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            check=True,
        )

        UI.success(f"Upgrade complete! Now on version {latest_version}")
        UI.print("\nPlease restart your terminal or run 'source ~/.zshrc' to use the new version.")

        if detected_extras is None and extras is None:
            UI.warn(
                "\nCould not auto-detect the extras you originally installed "
                "(this often happens with editable installs). If nao errors on "
                f"a missing database driver or LLM after the upgrade, run:\n"
                f"  pip install --upgrade '{PACKAGE_NAME}[<your-extras>]'"
            )
    except subprocess.CalledProcessError as e:
        UI.error(f"Upgrade failed: {e}")
        UI.print(f"Error output: {e.stderr}")
        UI.print("\nYou can manually upgrade by running:")
        UI.print(f"  pip install --upgrade '{package_spec}'")
