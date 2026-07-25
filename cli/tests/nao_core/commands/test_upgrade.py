"""Unit tests for the upgrade command and its package-spec resolution."""

from __future__ import annotations

import sys
from unittest.mock import patch

from nao_core.commands.upgrade import _resolve_install_spec, upgrade

# -- _resolve_install_spec ----------------------------------------------------


def test_resolve_no_cli_flag_no_detected_extras_returns_base_package():
    with patch("nao_core.commands.upgrade.get_installed_extras", return_value=set()):
        spec, detected = _resolve_install_spec(None)

    assert spec == "nao-core"
    assert detected == set()


def test_resolve_no_cli_flag_detected_extras_includes_them_alphabetically():
    with patch(
        "nao_core.commands.upgrade.get_installed_extras",
        return_value={"openai", "postgres", "all"},
    ):
        spec, detected = _resolve_install_spec(None)

    assert spec == "nao-core[all,openai,postgres]"
    assert detected == {"all", "openai", "postgres"}


def test_resolve_cli_flag_overrides_detection():
    with patch(
        "nao_core.commands.upgrade.get_installed_extras",
        return_value={"postgres"},
    ):
        spec, detected = _resolve_install_spec("postgres,openai")

    assert spec == "nao-core[openai,postgres]"
    assert detected == {"postgres", "openai"}


def test_resolve_cli_flag_empty_string_means_base_package():
    with patch(
        "nao_core.commands.upgrade.get_installed_extras",
        return_value={"postgres"},
    ):
        spec, detected = _resolve_install_spec("")

    assert spec == "nao-core"
    assert detected == set()


def test_resolve_cli_flag_strips_whitespace_and_drops_empty_segments():
    with patch("nao_core.commands.upgrade.get_installed_extras", return_value=set()):
        spec, detected = _resolve_install_spec(" postgres , , openai , ")

    assert spec == "nao-core[openai,postgres]"
    assert detected == {"openai", "postgres"}


def test_resolve_detection_unavailable_returns_none_marker():
    with patch("nao_core.commands.upgrade.get_installed_extras", return_value=None):
        spec, detected = _resolve_install_spec(None)

    assert spec == "nao-core"
    assert detected is None  # caller is responsible for warning the user


# -- upgrade() end-to-end via the subprocess + UI boundary -------------------


def test_upgrade_with_detected_extras_installs_specified_package():
    with (
        patch("nao_core.commands.upgrade.__version__", "0.1.0"),
        patch("nao_core.commands.upgrade.get_latest_version", return_value="0.2.0"),
        patch(
            "nao_core.commands.upgrade.get_installed_extras",
            return_value={"postgres", "openai"},
        ),
        patch("nao_core.commands.upgrade.ask_confirm", return_value=True),
        patch("nao_core.commands.upgrade.shutil.which", return_value="uv"),
        patch("nao_core.commands.upgrade.subprocess.run") as mock_run,
        patch("nao_core.commands.upgrade.UI.success"),
        patch("nao_core.commands.upgrade.UI.warn"),
        patch("nao_core.commands.upgrade.UI.error"),
        patch("nao_core.commands.upgrade.UI.print"),
        patch("nao_core.commands.upgrade.UI.info"),
    ):
        upgrade()

    mock_run.assert_called_once()
    cmd = mock_run.call_args[0][0]
    assert cmd[0] == "uv"
    assert cmd[1:] == ["pip", "install", "--upgrade", "nao-core[openai,postgres]"]


def test_upgrade_with_no_extras_installs_base_package():
    with (
        patch("nao_core.commands.upgrade.__version__", "0.1.0"),
        patch("nao_core.commands.upgrade.get_latest_version", return_value="0.2.0"),
        patch("nao_core.commands.upgrade.get_installed_extras", return_value=set()),
        patch("nao_core.commands.upgrade.ask_confirm", return_value=True),
        patch("nao_core.commands.upgrade.shutil.which", return_value="uv"),
        patch("nao_core.commands.upgrade.subprocess.run") as mock_run,
        patch("nao_core.commands.upgrade.UI.success"),
        patch("nao_core.commands.upgrade.UI.warn"),
        patch("nao_core.commands.upgrade.UI.error"),
        patch("nao_core.commands.upgrade.UI.print"),
        patch("nao_core.commands.upgrade.UI.info"),
    ):
        upgrade()

    cmd = mock_run.call_args[0][0]
    assert cmd[-1] == "nao-core"


def test_upgrade_cli_extras_overrides_detection():
    with (
        patch("nao_core.commands.upgrade.__version__", "0.1.0"),
        patch("nao_core.commands.upgrade.get_latest_version", return_value="0.2.0"),
        patch(
            "nao_core.commands.upgrade.get_installed_extras",
            return_value={"postgres"},
        ),
        patch("nao_core.commands.upgrade.ask_confirm", return_value=True),
        patch("nao_core.commands.upgrade.shutil.which", return_value="uv"),
        patch("nao_core.commands.upgrade.subprocess.run") as mock_run,
        patch("nao_core.commands.upgrade.UI.success"),
        patch("nao_core.commands.upgrade.UI.warn"),
        patch("nao_core.commands.upgrade.UI.error"),
        patch("nao_core.commands.upgrade.UI.print"),
        patch("nao_core.commands.upgrade.UI.info"),
    ):
        upgrade(extras="snowflake,athena")

    cmd = mock_run.call_args[0][0]
    assert cmd[-1] == "nao-core[athena,snowflake]"


def test_upgrade_with_unavailable_detection_warns_user():
    with (
        patch("nao_core.commands.upgrade.__version__", "0.1.0"),
        patch("nao_core.commands.upgrade.get_latest_version", return_value="0.2.0"),
        patch("nao_core.commands.upgrade.get_installed_extras", return_value=None),
        patch("nao_core.commands.upgrade.ask_confirm", return_value=True),
        patch("nao_core.commands.upgrade.shutil.which", return_value="uv"),
        patch("nao_core.commands.upgrade.subprocess.run") as mock_run,
        patch("nao_core.commands.upgrade.UI.success"),
        patch("nao_core.commands.upgrade.UI.warn") as mock_warn,
        patch("nao_core.commands.upgrade.UI.error"),
        patch("nao_core.commands.upgrade.UI.print"),
        patch("nao_core.commands.upgrade.UI.info"),
    ):
        upgrade()

    mock_run.assert_called_once()
    assert any("Could not auto-detect" in str(call) for call in mock_warn.call_args_list)


def test_upgrade_already_up_to_date_does_nothing():
    with (
        patch("nao_core.commands.upgrade.__version__", "0.2.0"),
        patch("nao_core.commands.upgrade.get_latest_version", return_value="0.2.0"),
        patch("nao_core.commands.upgrade.get_installed_extras", return_value=set()),
        patch("nao_core.commands.upgrade.ask_confirm", return_value=True),
        patch("nao_core.commands.upgrade.shutil.which", return_value="uv"),
        patch("nao_core.commands.upgrade.subprocess.run") as mock_run,
        patch("nao_core.commands.upgrade.UI.success") as mock_success,
        patch("nao_core.commands.upgrade.UI.warn"),
        patch("nao_core.commands.upgrade.UI.error"),
        patch("nao_core.commands.upgrade.UI.print"),
        patch("nao_core.commands.upgrade.UI.info"),
    ):
        upgrade()

    mock_run.assert_not_called()
    mock_success.assert_called_once()


def test_upgrade_user_declines_skips_install():
    with (
        patch("nao_core.commands.upgrade.__version__", "0.1.0"),
        patch("nao_core.commands.upgrade.get_latest_version", return_value="0.2.0"),
        patch("nao_core.commands.upgrade.get_installed_extras", return_value=set()),
        patch("nao_core.commands.upgrade.ask_confirm", return_value=False),
        patch("nao_core.commands.upgrade.shutil.which", return_value="uv"),
        patch("nao_core.commands.upgrade.subprocess.run") as mock_run,
        patch("nao_core.commands.upgrade.UI.success") as mock_success,
        patch("nao_core.commands.upgrade.UI.warn"),
        patch("nao_core.commands.upgrade.UI.error"),
        patch("nao_core.commands.upgrade.UI.print"),
        patch("nao_core.commands.upgrade.UI.info"),
    ):
        upgrade()

    mock_run.assert_not_called()
    mock_success.assert_not_called()


def test_upgrade_pypi_unreachable_reports_error():
    with (
        patch("nao_core.commands.upgrade.__version__", "0.1.0"),
        patch("nao_core.commands.upgrade.get_latest_version", return_value=None),
        patch("nao_core.commands.upgrade.get_installed_extras", return_value=set()),
        patch("nao_core.commands.upgrade.ask_confirm", return_value=True),
        patch("nao_core.commands.upgrade.shutil.which", return_value="uv"),
        patch("nao_core.commands.upgrade.subprocess.run") as mock_run,
        patch("nao_core.commands.upgrade.UI.success"),
        patch("nao_core.commands.upgrade.UI.warn"),
        patch("nao_core.commands.upgrade.UI.error") as mock_error,
        patch("nao_core.commands.upgrade.UI.print"),
        patch("nao_core.commands.upgrade.UI.info"),
    ):
        upgrade()

    mock_run.assert_not_called()
    mock_error.assert_called_once()


def test_upgrade_install_command_falls_back_to_pip_when_uv_missing():
    with (
        patch("nao_core.commands.upgrade.__version__", "0.1.0"),
        patch("nao_core.commands.upgrade.get_latest_version", return_value="0.2.0"),
        patch(
            "nao_core.commands.upgrade.get_installed_extras",
            return_value={"postgres"},
        ),
        patch("nao_core.commands.upgrade.ask_confirm", return_value=True),
        patch("nao_core.commands.upgrade.shutil.which", return_value=None),
        patch("nao_core.commands.upgrade.subprocess.run") as mock_run,
        patch("nao_core.commands.upgrade.UI.success"),
        patch("nao_core.commands.upgrade.UI.warn"),
        patch("nao_core.commands.upgrade.UI.error"),
        patch("nao_core.commands.upgrade.UI.print"),
        patch("nao_core.commands.upgrade.UI.info"),
    ):
        upgrade()

    cmd = mock_run.call_args[0][0]
    assert cmd[0] == sys.executable
    assert cmd[1:3] == ["-m", "pip"]
    assert cmd[-1] == "nao-core[postgres]"
