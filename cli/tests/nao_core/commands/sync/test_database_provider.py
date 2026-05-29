"""Unit tests for the database sync provider."""

from io import StringIO
from pathlib import Path
from unittest.mock import MagicMock, patch

from rich.console import Console

from nao_core.commands.sync.cleanup import DatabaseSyncState
from nao_core.commands.sync.providers.databases.provider import (
    DatabaseSyncProvider,
    _fetch_query_history,
)
from nao_core.config.base import NaoConfig
from nao_core.config.databases.duckdb import DuckDBConfig
from nao_core.deps import MissingDependencyError


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

    @patch("nao_core.commands.sync.providers.databases.provider.cleanup_stale_paths", return_value=0)
    @patch("nao_core.commands.sync.providers.databases.provider.sync_database")
    def test_sync_uses_distinct_db_folders_for_duplicate_database_names(
        self, mock_sync_database, _mock_cleanup_stale_paths, tmp_path: Path
    ):
        provider = DatabaseSyncProvider()

        db1 = MagicMock()
        db1.name = "clickhouse-last"
        db1.type = "clickhouse"
        db1.accessors = []
        db1.get_database_name.return_value = "default"

        db2 = MagicMock()
        db2.name = "clickhouse-numia"
        db2.type = "clickhouse"
        db2.accessors = []
        db2.get_database_name.return_value = "default"

        mock_sync_database.side_effect = [
            DatabaseSyncState(db_path=tmp_path / "type=clickhouse" / "database=clickhouse-last"),
            DatabaseSyncState(db_path=tmp_path / "type=clickhouse" / "database=clickhouse-numia"),
        ]

        provider.sync([db1, db2], tmp_path)

        db_folders = [call.kwargs.get("db_folder") for call in mock_sync_database.call_args_list]
        assert db_folders == [
            "database=clickhouse-last",
            "database=clickhouse-numia",
        ]

    @patch(
        "nao_core.commands.sync.providers.databases.provider.get_database_folder_names", return_value=["database=dev"]
    )
    @patch("nao_core.commands.sync.providers.databases.provider.sync_database")
    def test_sync_escapes_missing_dependency_error_markup(
        self, mock_sync_database, _mock_get_database_folder_names, tmp_path: Path
    ):
        provider = DatabaseSyncProvider()
        output = StringIO()
        console = Console(file=output, force_terminal=False)

        db = MagicMock()
        db.name = "redshift"
        db.templates = [MagicMock(value="columns")]
        mock_sync_database.side_effect = MissingDependencyError(
            "ibis-framework[postgres]",
            "redshift",
            "to connect to redshift databases",
        )

        with patch("nao_core.commands.sync.providers.databases.provider.console", console):
            provider.sync([db], tmp_path)

        text = output.getvalue()
        assert "ibis-framework[postgres]" in text
        assert "nao-core[redshift]" in text


class TestFetchQueryHistoryFiltering:
    """Verify that exclude patterns are applied after fetching query history."""

    def _build_cursor(self, queries: list[str]) -> MagicMock:
        cursor = MagicMock(spec=["description", "fetchall"])
        cursor.description = [("query_text",)]
        cursor.fetchall.return_value = [(q,) for q in queries]
        return cursor

    def test_exclude_patterns_drop_matching_queries(self):
        db = DuckDBConfig(
            name="duck",
            path=":memory:",
            query_history_sql="SELECT q AS query_text FROM logs",
            query_history_exclude_patterns=[r"SYSTEM\$", r"^SELECT CURRENT_SESSION"],
        )
        conn = MagicMock()
        conn.raw_sql.return_value = self._build_cursor(
            [
                "SELECT * FROM users",
                "CALL SYSTEM$GET_RECENT_IN_APP_NOTIFICATIONS()",
                "SELECT CURRENT_SESSION()",
                "SELECT * FROM orders",
            ]
        )

        result = _fetch_query_history(db, conn)

        assert result == ["SELECT * FROM users", "SELECT * FROM orders"]
        conn.raw_sql.assert_called_once_with("SELECT q AS query_text FROM logs")

    def test_no_exclude_patterns_returns_all_queries(self):
        db = DuckDBConfig(
            name="duck",
            path=":memory:",
            query_history_sql="SELECT q AS query_text FROM logs",
        )
        conn = MagicMock()
        conn.raw_sql.return_value = self._build_cursor(["SELECT 1", "SELECT 2"])

        result = _fetch_query_history(db, conn)

        assert result == ["SELECT 1", "SELECT 2"]

    def test_returns_empty_when_no_query_history_sql(self):
        db = DuckDBConfig(name="duck", path=":memory:")
        conn = MagicMock()

        result = _fetch_query_history(db, conn)

        assert result == []
        conn.raw_sql.assert_not_called()
