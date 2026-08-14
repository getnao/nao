import subprocess
import sys
from unittest.mock import patch

import pytest
from packaging.version import InvalidVersion, Version

from nao_core import __version__
from nao_core.version import check_for_updates, parse_version


def test_check_for_updates_warns_for_newer_cached_version():
    with (
        patch("nao_core.version._read_cache", return_value="99.0.0"),
        patch("nao_core.version.UI.warn") as mock_warn,
        patch("nao_core.version.subprocess.Popen") as mock_popen,
    ):
        check_for_updates()

    mock_warn.assert_called_once_with(f"Update available: {__version__} → 99.0.0. Run: nao upgrade")
    mock_popen.assert_not_called()


def test_check_for_updates_does_nothing_for_current_cached_version():
    with (
        patch("nao_core.version._read_cache", return_value=__version__),
        patch("nao_core.version.UI.warn") as mock_warn,
        patch("nao_core.version.subprocess.Popen") as mock_popen,
    ):
        check_for_updates()

    mock_warn.assert_not_called()
    mock_popen.assert_not_called()


def test_check_for_updates_spawns_detached_cache_refresh():
    with (
        patch("nao_core.version._read_cache", return_value=None),
        patch("nao_core.version.UI.warn") as mock_warn,
        patch("nao_core.version.subprocess.Popen") as mock_popen,
    ):
        check_for_updates()

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


class TestParseVersion:
    """`parse_version` used to crash on every pre-release shape; it now returns
    a `Version` that follows PEP 440 ordering."""

    @pytest.mark.parametrize(
        ("raw", "expected_str"),
        [
            ("0.1.9", "0.1.9"),
            ("0.0.37", "0.0.37"),
            ("99.0.0", "99.0.0"),
            # Pre-releases the old parser crashed on
            ("0.1.10a1", "0.1.10a1"),
            ("0.1.10b2", "0.1.10b2"),
            ("0.1.10rc1", "0.1.10rc1"),
            ("0.1.10.dev1", "0.1.10.dev1"),
            ("0.1.10.post1", "0.1.10.post1"),
        ],
    )
    def test_accepts_pep440_shapes(self, raw, expected_str):
        assert parse_version(raw) == Version(expected_str)

    def test_alpha_is_not_newer_than_its_final(self):
        # PEP 440: 0.1.10a1 < 0.1.10. A cached pre-release of the current
        # final version must NOT trigger the "Update available" warning.
        assert not (parse_version("0.1.10a1") > parse_version("0.1.10"))

    def test_rc_is_not_newer_than_its_final(self):
        assert not (parse_version("0.1.10rc1") > parse_version("0.1.10"))

    def test_dev_is_not_newer_than_its_final(self):
        assert not (parse_version("0.1.10.dev1") > parse_version("0.1.10"))

    def test_post_is_newer_than_its_final(self):
        # 0.1.10.post1 > 0.1.10 in PEP 440 ordering. A post-release on the
        # same final version should still trigger an "Update available" hint.
        assert parse_version("0.1.10.post1") > parse_version("0.1.10")

    def test_final_is_newer_than_prior_final(self):
        assert parse_version("0.1.10") > parse_version("0.1.9")

    def test_invalid_raises_invalid_version(self):
        # The old `tuple(int(x) for x in v.split("."))` raised a bare
        # `ValueError`; PEP 440 raises a specific subclass so callers can
        # catch the exact failure mode.
        with pytest.raises(InvalidVersion):
            parse_version("not-a-version")

    def test_check_for_updates_skips_malformed_cache(self):
        # The existing try/except in `check_for_updates` should swallow the
        # InvalidVersion so a corrupted cache file cannot crash every command.
        with (
            patch("nao_core.version._read_cache", return_value="garbage"),
            patch("nao_core.version.UI.warn") as mock_warn,
            patch("nao_core.version.subprocess.Popen") as mock_popen,
        ):
            check_for_updates()

        mock_warn.assert_not_called()
        mock_popen.assert_not_called()

    def test_check_for_updates_skips_pre_release_newer_than_current(self):
        # A cached pre-release of the same final as the installed version
        # must NOT trigger the warning.
        with (
            patch("nao_core.version._read_cache", return_value="0.1.10a1"),
            patch("nao_core.version.UI.warn") as mock_warn,
        ):
            # Pretend we are on 0.1.10 so the cached alpha of 0.1.10 is not
            # actually an upgrade.
            with patch("nao_core.version.__version__", "0.1.10"):
                check_for_updates()

        mock_warn.assert_not_called()
