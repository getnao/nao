"""Check for newer nao-core versions on PyPI."""

import json
import subprocess
import sys
import time
from importlib import metadata
from pathlib import Path

from nao_core import __version__
from nao_core.ui import UI

CACHE_FILE = Path.home() / ".nao" / "version_check.json"
PYPI_URL = "https://pypi.org/pypi/nao-core/json"
CHECK_INTERVAL = 24 * 60 * 60
PACKAGE_NAME = "nao-core"


def parse_version(v: str) -> tuple[int, ...]:
    """Parse a version string like '0.0.37' into a comparable tuple."""
    return tuple(int(x) for x in v.split("."))


def get_installed_extras() -> set[str] | None:
    """Return the extras the user installed alongside nao-core, or None if undetectable.

    Returns:
        A sorted set of active extras (e.g. {"postgres", "openai"}) when the
        installed distribution exposes them. Returns None when the package is
        editable-installed, missing, or installed on a Python version that
        does not surface the ``Distribution.extras`` property. Callers should
        fall back to warning the user rather than guessing.
    """
    try:
        dist = metadata.distribution(PACKAGE_NAME)
    except metadata.PackageNotFoundError:
        return None

    extras = getattr(dist, "extras", None)
    if extras is None:
        # Editable installs (PathDistribution) and some legacy distributions
        # don't expose `.extras`. Fall back to parsing Requires-Dist.
        try:
            reqs = dist.metadata.get_all("Requires-Dist") or []
        except AttributeError:
            return None
        extras = set()
        for req in reqs:
            marker = '; extra == "'
            if marker in req:
                extras.add(req.split(marker, 1)[1].rstrip('"'))
        if not extras:
            return None

    return {e for e in extras if e}


def get_latest_version() -> str | None:
    """Get latest version from PyPI (blocking). Used by `nao upgrade`."""
    latest = _read_cache()
    if latest is None:
        latest = _fetch_and_cache()
    return latest


def check_for_updates() -> None:
    """Non-blocking version check. Shows a warning only on cache hit; refreshes cache in background."""
    try:
        cached = _read_cache()
        if cached is not None:
            if parse_version(cached) > parse_version(__version__):
                UI.warn(f"Update available: {__version__} → {cached}. Run: nao upgrade")
            return

        _spawn_background_refresh()
    except Exception:
        pass


def _spawn_background_refresh() -> None:
    """Refresh the version cache in a detached process."""
    command = [
        sys.executable,
        "-c",
        "from nao_core.version import _fetch_and_cache; _fetch_and_cache()",
    ]

    try:
        if sys.platform == "win32":
            creationflags = getattr(subprocess, "CREATE_NO_WINDOW", 0) | getattr(subprocess, "DETACHED_PROCESS", 0)
            subprocess.Popen(
                command,
                stdin=subprocess.DEVNULL,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                creationflags=creationflags,
            )
        else:
            subprocess.Popen(
                command,
                stdin=subprocess.DEVNULL,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                start_new_session=True,
            )
    except Exception:
        pass


def clear_version_cache() -> None:
    """Clear the version check cache file."""
    if CACHE_FILE.exists():
        CACHE_FILE.unlink()


def _read_cache() -> str | None:
    """Return cached latest version if cache exists and is fresh, else None."""
    if not CACHE_FILE.exists():
        return None
    data = json.loads(CACHE_FILE.read_text())
    if time.time() - data.get("checked_at", 0) < CHECK_INTERVAL:
        return data.get("latest")
    return None


def _fetch_and_cache() -> str | None:
    """Fetch latest version from PyPI and write it to the cache file."""
    try:
        import httpx

        data = httpx.get(PYPI_URL, timeout=3).json()
        latest = data["info"]["version"]
        CACHE_FILE.parent.mkdir(parents=True, exist_ok=True)
        CACHE_FILE.write_text(json.dumps({"latest": latest, "checked_at": time.time()}))
        return latest
    except Exception:
        return None
