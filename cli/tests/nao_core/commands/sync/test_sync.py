"""Unit tests for the main sync command function."""

from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

from nao_core.commands.sync import sync
from nao_core.commands.sync.providers import (
    DatabaseSyncProvider,
    ProviderSelection,
    SyncProvider,
    SyncResult,
)


def _make_provider(
    name="TestProvider",
    should_sync=True,
    items=None,
    items_synced=0,
    output_dir="test-output",
    sync_error=None,
    result_error=None,
    emoji=None,
    spec=SyncProvider,
):
    provider = MagicMock(spec=spec)
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
            error=result_error,
        )
    return ProviderSelection(provider)


@pytest.fixture
def sync_console():
    with patch("nao_core.commands.sync.console") as console:
        yield console


@pytest.mark.usefixtures("clean_env", "sync_console")
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
        selection = _make_provider()

        sync(_providers=[selection])

        selection.provider.should_sync.assert_called_once()

    def test_sync_uses_custom_output_dirs(self, tmp_path: Path, create_config):
        create_config()
        selection = _make_provider(output_dir="default-output", items=["item1"], items_synced=1)

        custom_output = str(tmp_path / "custom-output")

        sync(output_dirs={"TestProvider": custom_output}, _providers=[selection])

        call_args = selection.provider.sync.call_args
        assert str(call_args[0][1]) == custom_output

    def test_sync_uses_threads_from_config(self, create_config):
        create_config("project_name: test-project\nthreads: 3\n")
        selection = _make_provider(items=["item1"], items_synced=1)

        sync(_providers=[selection])

        assert selection.provider.sync.call_args.kwargs["threads"] == 3

    def test_sync_forwards_select_to_database_provider(self, create_config):
        create_config()
        selection = _make_provider(name="Databases", output_dir="databases", spec=DatabaseSyncProvider)

        sync(_providers=[selection], select=["analytics.orders"], render_templates=False)

        assert selection.provider.sync.call_args.kwargs.get("select") == ["analytics.orders"]

    def test_sync_warns_and_skips_select_for_non_database_provider(self, create_config, sync_console):
        create_config()
        selection = _make_provider(items=["item1"], items_synced=1)

        sync(_providers=[selection], select=["analytics.orders"], render_templates=False)

        sync_console.print.assert_any_call(
            "[yellow]Warning:[/yellow] --select only applies to the databases provider; ignoring it here."
        )
        assert "select" not in selection.provider.sync.call_args.kwargs

    def test_sync_cli_threads_override_config(self, create_config):
        create_config("project_name: test-project\nthreads: 3\n")
        selection = _make_provider(items=["item1"], items_synced=1)

        sync(threads=5, _providers=[selection])

        assert selection.provider.sync.call_args.kwargs["threads"] == 5

    def test_sync_rejects_invalid_cli_threads(self, create_config):
        create_config()
        selection = _make_provider(items=["item1"], items_synced=1)

        with pytest.raises(SystemExit) as exc_info:
            sync(threads=0, _providers=[selection])

        assert exc_info.value.code == 1
        selection.provider.sync.assert_not_called()

    def test_sync_skips_provider_when_should_sync_false(self, create_config):
        create_config()
        selection = _make_provider(should_sync=False)

        sync(_providers=[selection])

        selection.provider.sync.assert_not_called()

    def test_sync_prints_nothing_to_sync_when_no_results(self, create_config, sync_console):
        create_config()
        selection = _make_provider()

        sync(_providers=[selection])

        calls = [str(call) for call in sync_console.print.call_args_list]
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

        with pytest.raises(SystemExit) as exc_info:
            sync(_providers=[failing, working])

        assert exc_info.value.code == 1
        failing.provider.sync.assert_called_once()
        working.provider.sync.assert_called_once()

    def test_sync_exits_when_provider_returns_failed_result(self, create_config):
        create_config()
        failing = _make_provider(items=["item1"], result_error="Failed to sync 1 item")

        with pytest.raises(SystemExit) as exc_info:
            sync(_providers=[failing], render_templates=False)

        assert exc_info.value.code == 1

    def test_sync_shows_partial_success_when_some_providers_fail(self, create_config, sync_console):
        """Test that sync shows partial success status when some providers fail."""
        create_config()
        failing = _make_provider(
            name="FailingProvider", emoji="❌", output_dir="failing-output", sync_error="API error"
        )
        working = _make_provider(
            name="WorkingProvider", emoji="✅", output_dir="working-output", items=["item1"], items_synced=1
        )

        with pytest.raises(SystemExit) as exc_info:
            sync(_providers=[failing, working])

        assert exc_info.value.code == 1
        calls = [str(call) for call in sync_console.print.call_args_list]
        assert any("Sync Completed with Errors" in call for call in calls)
        assert any("API error" in call for call in calls)

    def test_sync_shows_failure_when_all_providers_fail(self, create_config, sync_console):
        """Test that sync shows failure status when all providers fail."""
        create_config()
        failing = _make_provider(
            name="FailingProvider", emoji="❌", output_dir="failing-output", sync_error="Connection timeout"
        )

        with pytest.raises(SystemExit) as exc_info:
            sync(_providers=[failing])

        assert exc_info.value.code == 1
        calls = [str(call) for call in sync_console.print.call_args_list]
        assert any("Sync Failed" in call for call in calls)
