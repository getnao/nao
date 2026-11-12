import subprocess
import sys
from unittest.mock import MagicMock, patch

from nao_core import __version__
from nao_core.version import check_for_updates


def test_check_for_updates_warns_for_newer_cached_version():
    mock_warn, mock_popen = _check_for_updates_with_cache("99.0.0")

    mock_warn.assert_called_once_with(f"Update available: {__version__} → 99.0.0. Run: nao upgrade")
    mock_popen.assert_not_called()


def test_check_for_updates_does_nothing_for_current_cached_version():
    mock_warn, mock_popen = _check_for_updates_with_cache(__version__)

    mock_warn.assert_not_called()
    mock_popen.assert_not_called()


def test_check_for_updates_spawns_detached_cache_refresh():
    mock_warn, mock_popen = _check_for_updates_with_cache(None)

    expected_kwargs = {
        "stdin": subprocess.DEVNULL,
        "stdout": subprocess.DEVNULL,
        "stderr": subprocess.DEVNULL,
    }
    if sys.platform == "win32":
        expected_kwargs["creationflags"] = subprocess.CREATE_NO_WINDOW | subprocess.DETACHED_PROCESS
    else:
        expected_kwargs["start_new_session"] = True

    mock_popen.assert_called_once_with(
        [
            sys.executable,
            "-c",
            "from nao_core.version import _fetch_and_cache; _fetch_and_cache()",
        ],
        **expected_kwargs,
    )
    mock_warn.assert_not_called()
    mock_popen.return_value.wait.assert_not_called()
    mock_popen.return_value.communicate.assert_not_called()


def _check_for_updates_with_cache(cached_version: str | None) -> tuple[MagicMock, MagicMock]:
    with (
        patch("nao_core.version._read_cache", return_value=cached_version),
        patch("nao_core.version.UI.warn") as mock_warn,
        patch("nao_core.version.subprocess.Popen") as mock_popen,
    ):
        check_for_updates()
    return mock_warn, mock_popen
