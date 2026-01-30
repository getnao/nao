"""Unit tests for the main sync command function."""

from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

from nao_core.commands.sync import sync
from nao_core.commands.sync.providers import SyncProvider, SyncResult


class TestSyncCommand:
    def test_sync_exits_when_no_config_found(self, tmp_path: Path, monkeypatch):
        monkeypatch.chdir(tmp_path)
        # Ensure NAO_DEFAULT_PROJECT_PATH doesn't point to a valid config
        monkeypatch.delenv("NAO_DEFAULT_PROJECT_PATH", raising=False)

        with patch("nao_core.commands.sync.console") as mock_console:
            with pytest.raises(SystemExit) as exc_info:
                sync()

            assert exc_info.value.code == 1
            mock_console.print.assert_any_call("[bold red]✗[/bold red] No nao_config.yaml found in current directory")

    def test_sync_runs_providers_when_config_exists(self, tmp_path: Path, monkeypatch):
        # Create a valid config file
        config_file = tmp_path / "nao_config.yaml"
        config_file.write_text("project_name: test-project\n")
        monkeypatch.chdir(tmp_path)

        mock_provider = MagicMock(spec=SyncProvider)
        mock_provider.should_sync.return_value = True
        mock_provider.name = "TestProvider"
        mock_provider.default_output_dir = "test-output"
        mock_provider.get_items.return_value = []
        mock_provider.sync.return_value = SyncResult(
            provider_name="TestProvider",
            items_synced=0,
        )

        with patch("nao_core.commands.sync.console"):
            sync(providers=[mock_provider])

        mock_provider.should_sync.assert_called_once()

    def test_sync_uses_custom_output_dirs(self, tmp_path: Path, monkeypatch):
        # Create a valid config file
        config_file = tmp_path / "nao_config.yaml"
        config_file.write_text("project_name: test-project\n")
        monkeypatch.chdir(tmp_path)

        mock_provider = MagicMock(spec=SyncProvider)
        mock_provider.should_sync.return_value = True
        mock_provider.name = "TestProvider"
        mock_provider.default_output_dir = "default-output"
        mock_provider.get_items.return_value = ["item1"]
        mock_provider.sync.return_value = SyncResult(
            provider_name="TestProvider",
            items_synced=1,
        )

        custom_output = str(tmp_path / "custom-output")

        with patch("nao_core.commands.sync.console"):
            sync(output_dirs={"TestProvider": custom_output}, providers=[mock_provider])

        # Verify sync was called with the custom output path
        call_args = mock_provider.sync.call_args
        assert str(call_args[0][1]) == custom_output

    def test_sync_skips_provider_when_should_sync_false(self, tmp_path: Path, monkeypatch):
        # Create a valid config file
        config_file = tmp_path / "nao_config.yaml"
        config_file.write_text("project_name: test-project\n")
        monkeypatch.chdir(tmp_path)

        mock_provider = MagicMock(spec=SyncProvider)
        mock_provider.should_sync.return_value = False

        with patch("nao_core.commands.sync.console"):
            sync(providers=[mock_provider])

        # sync should not be called when should_sync returns False
        mock_provider.sync.assert_not_called()

    def test_sync_prints_nothing_to_sync_when_no_results(self, tmp_path: Path, monkeypatch):
        # Create a valid config file
        config_file = tmp_path / "nao_config.yaml"
        config_file.write_text("project_name: test-project\n")
        monkeypatch.chdir(tmp_path)

        mock_provider = MagicMock(spec=SyncProvider)
        mock_provider.should_sync.return_value = True
        mock_provider.name = "TestProvider"
        mock_provider.default_output_dir = "test-output"
        mock_provider.get_items.return_value = []
        mock_provider.sync.return_value = SyncResult(
            provider_name="TestProvider",
            items_synced=0,
        )

        with patch("nao_core.commands.sync.console") as mock_console:
            sync(providers=[mock_provider])

        # Check that "Nothing to sync" was printed
        calls = [str(call) for call in mock_console.print.call_args_list]
        assert any("Nothing to sync" in call for call in calls)

    def test_sync_continues_when_provider_fails(self, tmp_path: Path, monkeypatch):
        """Test that sync continues with other providers when one fails."""
        config_file = tmp_path / "nao_config.yaml"
        config_file.write_text("project_name: test-project\n")
        monkeypatch.chdir(tmp_path)

        # First provider will fail
        failing_provider = MagicMock(spec=SyncProvider)
        failing_provider.should_sync.return_value = True
        failing_provider.name = "FailingProvider"
        failing_provider.emoji = "❌"
        failing_provider.default_output_dir = "failing-output"
        failing_provider.sync.side_effect = Exception("Connection failed")

        # Second provider should still run
        working_provider = MagicMock(spec=SyncProvider)
        working_provider.should_sync.return_value = True
        working_provider.name = "WorkingProvider"
        working_provider.emoji = "✅"
        working_provider.default_output_dir = "working-output"
        working_provider.get_items.return_value = ["item1"]
        working_provider.sync.return_value = SyncResult(
            provider_name="WorkingProvider",
            items_synced=1,
        )

        with patch("nao_core.commands.sync.console"):
            # Should not raise, even though first provider fails
            sync(providers=[failing_provider, working_provider])

        # Verify both providers were attempted
        failing_provider.sync.assert_called_once()
        working_provider.sync.assert_called_once()

    def test_sync_shows_partial_success_when_some_providers_fail(self, tmp_path: Path, monkeypatch):
        """Test that sync shows partial success status when some providers fail."""
        config_file = tmp_path / "nao_config.yaml"
        config_file.write_text("project_name: test-project\n")
        monkeypatch.chdir(tmp_path)

        failing_provider = MagicMock(spec=SyncProvider)
        failing_provider.should_sync.return_value = True
        failing_provider.name = "FailingProvider"
        failing_provider.emoji = "❌"
        failing_provider.default_output_dir = "failing-output"
        failing_provider.sync.side_effect = Exception("API error")

        working_provider = MagicMock(spec=SyncProvider)
        working_provider.should_sync.return_value = True
        working_provider.name = "WorkingProvider"
        working_provider.emoji = "✅"
        working_provider.default_output_dir = "working-output"
        working_provider.get_items.return_value = ["item1"]
        working_provider.sync.return_value = SyncResult(
            provider_name="WorkingProvider",
            items_synced=1,
        )

        with patch("nao_core.commands.sync.console") as mock_console:
            sync(providers=[failing_provider, working_provider])

        calls = [str(call) for call in mock_console.print.call_args_list]
        # Should show "Completed with Errors" status
        assert any("Sync Completed with Errors" in call for call in calls)
        # Should show error details
        assert any("API error" in call for call in calls)

    def test_sync_shows_failure_when_all_providers_fail(self, tmp_path: Path, monkeypatch):
        """Test that sync shows failure status when all providers fail."""
        config_file = tmp_path / "nao_config.yaml"
        config_file.write_text("project_name: test-project\n")
        monkeypatch.chdir(tmp_path)

        failing_provider = MagicMock(spec=SyncProvider)
        failing_provider.should_sync.return_value = True
        failing_provider.name = "FailingProvider"
        failing_provider.emoji = "❌"
        failing_provider.default_output_dir = "failing-output"
        failing_provider.sync.side_effect = Exception("Connection timeout")

        with patch("nao_core.commands.sync.console") as mock_console:
            sync(providers=[failing_provider])

        calls = [str(call) for call in mock_console.print.call_args_list]
        # Should show "Sync Failed" status
        assert any("Sync Failed" in call for call in calls)
