"""Unit tests for the database sync provider."""

from pathlib import Path
from unittest.mock import MagicMock, patch

from nao_core.commands.sync.providers.databases.provider import DatabaseSyncProvider
from nao_core.config.base import NaoConfig


class TestDatabaseSyncProvider:
    def test_provider_properties(self):
        provider = DatabaseSyncProvider()
        assert provider.name == "Databases"
        assert provider.emoji == "🗄️"
        assert provider.default_output_dir == "databases"

    def test_get_items_returns_databases_from_config(self):
        provider = DatabaseSyncProvider()
        mock_config = MagicMock(spec=NaoConfig)
        mock_db1 = MagicMock()
        mock_db1.name = "db1"
        mock_db2 = MagicMock()
        mock_db2.name = "db2"
        mock_config.databases = [mock_db1, mock_db2]

        items = provider.get_items(mock_config)

        assert len(items) == 2

    def test_get_items_returns_empty_list_when_no_databases(self):
        provider = DatabaseSyncProvider()
        mock_config = MagicMock(spec=NaoConfig)
        mock_config.databases = []

        items = provider.get_items(mock_config)

        assert items == []

    @patch("nao_core.commands.sync.providers.databases.provider.console")
    def test_sync_returns_zero_when_no_items(self, mock_console, tmp_path: Path):
        provider = DatabaseSyncProvider()

        result = provider.sync([], tmp_path)

        assert result.provider_name == "Databases"
        assert result.items_synced == 0

    def test_should_sync_returns_true_when_databases_exist(self):
        provider = DatabaseSyncProvider()
        mock_config = MagicMock(spec=NaoConfig)
        mock_config.databases = [MagicMock()]

        assert provider.should_sync(mock_config) is True

    def test_should_sync_returns_false_when_no_databases(self):
        provider = DatabaseSyncProvider()
        mock_config = MagicMock(spec=NaoConfig)
        mock_config.databases = []

        assert provider.should_sync(mock_config) is False
