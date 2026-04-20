"""Check for newer nao-core versions on PyPI."""

import atexit
import json
import threading
import time
from pathlib import Path

from nao_core import __version__
from nao_core.ui import UI

CACHE_FILE = Path.home() / ".nao" / "version_check.json"
PYPI_URL = "https://pypi.org/pypi/nao-core/json"
CHECK_INTERVAL = 24 * 60 * 60

_background_thread: threading.Thread | None = None


def parse_version(v: str) -> tuple[int, ...]:
    """Parse a version string like '0.0.37' into a comparable tuple."""
    return tuple(int(x) for x in v.split("."))


def get_latest_version() -> str | None:
    """Get latest version from PyPI (blocking). Used by `nao upgrade`."""
    latest = _read_cache()
    if latest is None:
        latest = _fetch_and_cache()
    return latest


def check_for_updates() -> None:
    """Non-blocking version check. Shows a warning only on cache hit; refreshes cache in background."""
    global _background_thread
    try:
        cached = _read_cache()
        if cached is not None:
            if parse_version(cached) > parse_version(__version__):
                UI.warn(f"Update available: {__version__} → {cached}. Run: nao upgrade")
            return

        _background_thread = threading.Thread(target=_fetch_and_cache, daemon=True)
        _background_thread.start()
        atexit.register(_wait_for_background_fetch)
    except Exception:
        pass


def _wait_for_background_fetch() -> None:
    """Wait briefly for the background fetch so the cache file is written before exit."""
    if _background_thread is not None and _background_thread.is_alive():
        _background_thread.join(timeout=5)


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
