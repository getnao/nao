"""Unit tests for the main sync command function."""

from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

from nao_core.commands.sync import sync
from nao_core.commands.sync.providers import SyncProvider, SyncResult


def _make_provider(
    name="TestProvider",
    should_sync=True,
    items=None,
    items_synced=0,
    output_dir="test-output",
    sync_error=None,
    emoji=None,
):
    provider = MagicMock(spec=SyncProvider)
    provider.should_sync.return_value = should_sync
    provider.name = name
    provider.default_output_dir = output_dir
    if emoji:
        provider.emoji = emoji
    if sync_error:
        provider.sync.side_effect = Exception(sync_error)
    else:
        provider.get_items.return_value = items or []
        provider.sync.return_value = SyncResult(
            provider_name=name,
            items_synced=items_synced,
        )
    return provider


@pytest.mark.usefixtures("clean_env")
class TestSyncCommand:
    def test_sync_exits_when_no_config_found(self, tmp_path: Path, monkeypatch):
        monkeypatch.chdir(tmp_path)

        with patch("nao_core.config.base.Console") as mock_console_cls:
            mock_console = mock_console_cls.return_value
            with pytest.raises(SystemExit) as exc_info:
                sync()

            assert exc_info.value.code == 1
            mock_console.print.assert_any_call("[bold red]✗[/bold red] No nao_config.yaml found in current directory")

    def test_sync_runs_providers_when_config_exists(self, create_config):
        create_config()
        mock_provider = _make_provider()

        with patch("nao_core.commands.sync.console"):
            sync(providers=[mock_provider])

        mock_provider.should_sync.assert_called_once()

    def test_sync_uses_custom_output_dirs(self, tmp_path: Path, create_config):
        create_config()
        mock_provider = _make_provider(output_dir="default-output", items=["item1"], items_synced=1)

        custom_output = str(tmp_path / "custom-output")

        with patch("nao_core.commands.sync.console"):
            sync(output_dirs={"TestProvider": custom_output}, providers=[mock_provider])

        # Verify sync was called with the custom output path
        call_args = mock_provider.sync.call_args
        assert str(call_args[0][1]) == custom_output

    def test_sync_skips_provider_when_should_sync_false(self, create_config):
        create_config()
        mock_provider = _make_provider(should_sync=False)

        with patch("nao_core.commands.sync.console"):
            sync(providers=[mock_provider])

        # sync should not be called when should_sync returns False
        mock_provider.sync.assert_not_called()

    def test_sync_prints_nothing_to_sync_when_no_results(self, create_config):
        create_config()
        mock_provider = _make_provider()

        with patch("nao_core.commands.sync.console") as mock_console:
            sync(providers=[mock_provider])

        # Check that "Nothing to sync" was printed
        calls = [str(call) for call in mock_console.print.call_args_list]
        assert any("Nothing to sync" in call for call in calls)

    def test_sync_continues_when_provider_fails(self, create_config):
        """Test that sync continues with other providers when one fails."""
        create_config()
        failing = _make_provider(
            name="FailingProvider", emoji="❌", output_dir="failing-output", sync_error="Connection failed"
        )
        working = _make_provider(
            name="WorkingProvider", emoji="✅", output_dir="working-output", items=["item1"], items_synced=1
        )

        with patch("nao_core.commands.sync.console"):
            with pytest.raises(SystemExit) as exc_info:
                sync(providers=[failing, working])

        assert exc_info.value.code == 1
        # Verify both providers were attempted
        failing.sync.assert_called_once()
        working.sync.assert_called_once()

    def test_sync_shows_partial_success_when_some_providers_fail(self, create_config):
        """Test that sync shows partial success status when some providers fail."""
        create_config()
        failing = _make_provider(
            name="FailingProvider", emoji="❌", output_dir="failing-output", sync_error="API error"
        )
        working = _make_provider(
            name="WorkingProvider", emoji="✅", output_dir="working-output", items=["item1"], items_synced=1
        )

        with patch("nao_core.commands.sync.console") as mock_console:
            with pytest.raises(SystemExit) as exc_info:
                sync(providers=[failing, working])

        assert exc_info.value.code == 1
        calls = [str(call) for call in mock_console.print.call_args_list]
        # Should show "Completed with Errors" status
        assert any("Sync Completed with Errors" in call for call in calls)
        # Should show error details
        assert any("API error" in call for call in calls)

    def test_sync_shows_failure_when_all_providers_fail(self, create_config):
        """Test that sync shows failure status when all providers fail."""
        create_config()
        failing = _make_provider(
            name="FailingProvider", emoji="❌", output_dir="failing-output", sync_error="Connection timeout"
        )

        with patch("nao_core.commands.sync.console") as mock_console:
            with pytest.raises(SystemExit) as exc_info:
                sync(providers=[failing])

        assert exc_info.value.code == 1
        calls = [str(call) for call in mock_console.print.call_args_list]
        # Should show "Sync Failed" status
        assert any("Sync Failed" in call for call in calls)
