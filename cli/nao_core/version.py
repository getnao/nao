"""Check for newer nao-core versions on PyPI."""

import json
import time
import urllib.request
from pathlib import Path

from nao_core import __version__
from nao_core.ui import UI

CACHE_FILE = Path.home() / ".nao" / "version_check.json"
PYPI_URL = "https://pypi.org/pypi/nao-core/json"
CHECK_INTERVAL = 24 * 60 * 60


def parse_version(v: str) -> tuple[int, ...]:
    """Parse a version string like '0.0.37' into a comparable tuple."""
    return tuple(int(x) for x in v.split("."))


def get_latest_version() -> str | None:
    """Get latest version from PyPI."""
    latest = _read_cache()
    if latest is None:
        latest = _fetch_and_cache()
    return latest


def check_for_updates() -> None:
    """Check PyPI for a newer version of nao-core, using a 24h local cache."""
    try:
        latest = get_latest_version()
        if latest is None:
            return

        if parse_version(latest) > parse_version(__version__):
            UI.warn(f"Update available: {__version__} → {latest}. Run: nao upgrade")
    except Exception:
        pass  # do nothing


def clear_version_cache() -> None:
    """Clear the version check cache file."""
    if CACHE_FILE.exists():
        CACHE_FILE.unlink()


def _read_cache() -> str | None:
    """Return cached latest version if cache exists and is fresh, else None."""
    if not CACHE_FILE.exists():
        return None
    data = json.loads(CACHE_FILE.read_text())
    # If not fresh tell check_for_updates to fetch again
    if time.time() - data.get("checked_at", 0) < CHECK_INTERVAL:
        return data.get("latest")
    return None


def _fetch_and_cache() -> str | None:
    """Fetch latest version from PyPI and write it to the cache file."""
    with urllib.request.urlopen(PYPI_URL, timeout=3) as resp:
        data = json.loads(resp.read())

    latest = data["info"]["version"]
    CACHE_FILE.parent.mkdir(parents=True, exist_ok=True)
    CACHE_FILE.write_text(json.dumps({"latest": latest, "checked_at": time.time()}))
    return latest
