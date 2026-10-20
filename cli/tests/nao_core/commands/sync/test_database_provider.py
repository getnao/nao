"""Unit tests for the database sync provider."""

from collections.abc import Iterator
from contextlib import contextmanager
from io import StringIO
from pathlib import Path
from unittest.mock import MagicMock, patch

from rich.console import Console

from nao_core.commands.sync.cleanup import DatabaseSyncState
from nao_core.commands.sync.providers.databases.provider import (
    DatabaseSyncProvider,
    _fetch_query_history,
    _matches_selection,
)
from nao_core.config.base import NaoConfig
from nao_core.config.databases.duckdb import DuckDBConfig
from nao_core.deps import MissingDependencyError
from nao_core.ui import UI

PROVIDER_MODULE = "nao_core.commands.sync.providers.databases.provider"
COLUMNS_TEMPLATES = [MagicMock(value="columns")]
QUERY_HISTORY_SQL = "SELECT q AS query_text FROM logs"


class TestDatabaseSyncProvider:
    def test_provider_properties(self):
        provider = DatabaseSyncProvider()
        assert provider.name == "Databases"
        assert provider.emoji == "🗄️"
        assert provider.default_output_dir == "databases"

    def test_get_items_returns_databases_from_config(self):
        provider = DatabaseSyncProvider()
        mock_config = MagicMock(spec=NaoConfig)
        mock_config.databases = [_database("db1"), _database("db2")]

        items = provider.get_items(mock_config)

        assert len(items) == 2

    def test_get_items_returns_empty_list_when_no_databases(self):
        provider = DatabaseSyncProvider()
        mock_config = MagicMock(spec=NaoConfig)
        mock_config.databases = []

        items = provider.get_items(mock_config)

        assert items == []

    @patch(f"{PROVIDER_MODULE}.UI._console")
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

    @patch(f"{PROVIDER_MODULE}.cleanup_stale_paths", return_value=0)
    @patch(f"{PROVIDER_MODULE}.sync_database")
    def test_sync_uses_distinct_db_folders_for_duplicate_database_names(
        self, mock_sync_database, _mock_cleanup_stale_paths, tmp_path: Path
    ):
        provider = DatabaseSyncProvider()

        db1 = _database("clickhouse-last", "default", type="clickhouse", accessors=[])
        db2 = _database("clickhouse-numia", "default", type="clickhouse", accessors=[])

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

    @patch(f"{PROVIDER_MODULE}.cleanup_stale_paths", return_value=0)
    @patch(f"{PROVIDER_MODULE}.sync_database")
    def test_filtered_sync_resolves_db_folder_against_all_configured_databases(
        self, mock_sync_database, _mock_cleanup_stale_paths, tmp_path: Path
    ):
        provider = DatabaseSyncProvider()
        shop_a = DuckDBConfig(name="shop_a_ro", path=str(tmp_path / "shop_a" / "retaildb.duckdb"))
        shop_b = DuckDBConfig(name="shop_b_ro", path=str(tmp_path / "shop_b" / "retaildb.duckdb"))
        provider.pre_sync(NaoConfig(project_name="shops", databases=[shop_a, shop_b]), tmp_path)
        mock_sync_database.return_value = DatabaseSyncState(db_path=tmp_path / "type=duckdb" / "database=shop_b_ro")

        provider.sync([shop_b], tmp_path)

        assert mock_sync_database.call_args.kwargs.get("db_folder") == "database=shop_b_ro"

    @patch(f"{PROVIDER_MODULE}.cleanup_stale_paths", return_value=0)
    @patch(f"{PROVIDER_MODULE}.sync_database")
    def test_sync_runs_databases_with_threads(self, mock_sync_database, _mock_cleanup_stale_paths, tmp_path: Path):
        provider = DatabaseSyncProvider()

        db1 = _duckdb_database("db1")
        db2 = _duckdb_database("db2")

        def _sync_database(db, *_args, **_kwargs):
            state = DatabaseSyncState(db_path=tmp_path / db.name)
            state.add_schema("main")
            state.add_table("main", "orders")
            return state

        mock_sync_database.side_effect = _sync_database

        result = provider.sync([db1, db2], tmp_path, threads=2)

        assert result.details == {"datasets": 2, "tables": 2, "removed": 0}
        assert mock_sync_database.call_count == 2

    @patch(f"{PROVIDER_MODULE}.get_database_folder_names", return_value=["database=dev"])
    @patch(f"{PROVIDER_MODULE}.sync_database")
    def test_sync_escapes_missing_dependency_error_markup(
        self, mock_sync_database, _mock_get_database_folder_names, tmp_path: Path
    ):
        provider = DatabaseSyncProvider()
        db = _database("redshift", templates=COLUMNS_TEMPLATES)
        mock_sync_database.side_effect = MissingDependencyError(
            "ibis-framework[postgres]",
            "redshift",
            "to connect to redshift databases",
        )

        with _captured_console() as (_console, output):
            result = provider.sync([db], tmp_path)

        text = output.getvalue()
        assert "ibis-framework[postgres]" in text
        assert "nao-core[redshift]" in text
        assert result.error is not None
        assert result.error.startswith("Failed to sync 1 database: redshift:")

    @patch(
        f"{PROVIDER_MODULE}.get_database_folder_names",
        return_value=["database=prod-red"],
    )
    @patch(f"{PROVIDER_MODULE}.sync_database")
    def test_sync_escapes_database_name_markup(
        self, mock_sync_database, _mock_get_database_folder_names, tmp_path: Path
    ):
        provider = DatabaseSyncProvider()
        db = _database("prod[red]", templates=COLUMNS_TEMPLATES)
        mock_sync_database.side_effect = RuntimeError("connection failed")

        with _captured_console() as (console, output):
            result = provider.sync([db], tmp_path)
            console.print(result.error)

        assert "prod[red]" in output.getvalue()


class TestMatchesSelection:
    def test_schema_only_pattern_selects_whole_schema(self):
        assert _matches_selection("analytics", "orders", ["analytics"]) is True
        assert _matches_selection("analytics", "customers", ["analytics"]) is True
        assert _matches_selection("staging", "orders", ["analytics"]) is False

    def test_schema_table_pattern_selects_single_table(self):
        assert _matches_selection("analytics", "orders", ["analytics.orders"]) is True
        assert _matches_selection("analytics", "customers", ["analytics.orders"]) is False

    def test_glob_patterns_are_supported(self):
        assert _matches_selection("staging", "dim_users", ["staging.dim_*"]) is True
        assert _matches_selection("staging", "fct_orders", ["staging.dim_*"]) is False

    def test_any_pattern_matches(self):
        select = ["analytics.orders", "staging"]
        assert _matches_selection("analytics", "orders", select) is True
        assert _matches_selection("staging", "anything", select) is True
        assert _matches_selection("analytics", "customers", select) is False

    def test_matching_is_case_insensitive(self):
        # Snowflake-style uppercased identifiers should match lowercase patterns.
        assert _matches_selection("ANALYTICS", "ORDERS", ["analytics.orders"]) is True
        assert _matches_selection("ANALYTICS", "ORDERS", ["analytics"]) is True
        assert _matches_selection("analytics", "orders", ["ANALYTICS.ORDERS"]) is True

    def test_catalog_qualified_schema_is_supported(self):
        # Some databases (e.g. StarRocks) qualify schemas with a catalog prefix.
        assert _matches_selection("catalog.analytics", "orders", ["catalog.analytics"]) is True
        assert _matches_selection("catalog.analytics", "orders", ["catalog.analytics.orders"]) is True
        assert _matches_selection("catalog.analytics", "orders", ["catalog.analytics.customers"]) is False
        # A bare schema name without the catalog prefix does not match.
        assert _matches_selection("catalog.analytics", "orders", ["analytics"]) is False


class TestSelectSkipsCleanup:
    @patch(f"{PROVIDER_MODULE}.cleanup_stale_paths", return_value=3)
    @patch(f"{PROVIDER_MODULE}.sync_database")
    def test_cleanup_runs_without_select(self, mock_sync_database, mock_cleanup, tmp_path: Path):
        provider = DatabaseSyncProvider()
        db = _duckdb_database("db1")
        mock_sync_database.return_value = DatabaseSyncState(db_path=tmp_path / "db1")

        result = provider.sync([db], tmp_path)

        mock_cleanup.assert_called_once()
        assert result.details is not None
        assert result.details["removed"] == 3
        assert mock_sync_database.call_args.kwargs.get("select") is None

    @patch(f"{PROVIDER_MODULE}.cleanup_stale_paths", return_value=3)
    @patch(f"{PROVIDER_MODULE}.sync_database")
    def test_cleanup_skipped_with_select(self, mock_sync_database, mock_cleanup, tmp_path: Path):
        provider = DatabaseSyncProvider()
        db = _duckdb_database("db1")
        mock_sync_database.return_value = DatabaseSyncState(db_path=tmp_path / "db1")

        result = provider.sync([db], tmp_path, select=["analytics.orders"])

        mock_cleanup.assert_not_called()
        assert result.details is not None
        assert result.details["removed"] == 0
        assert mock_sync_database.call_args.kwargs.get("select") == ["analytics.orders"]


class TestFetchQueryHistoryFiltering:
    """Verify that exclude patterns are applied after fetching query history."""

    def _build_cursor(self, queries: list[str]) -> MagicMock:
        cursor = MagicMock(spec=["description", "fetchall"])
        cursor.description = [("query_text",)]
        cursor.fetchall.return_value = [(q,) for q in queries]
        return cursor

    def test_exclude_patterns_drop_matching_queries(self):
        db = _duckdb_with_history(query_history_exclude_patterns=[r"SYSTEM\$", r"^SELECT CURRENT_SESSION"])
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
        conn.raw_sql.assert_called_once_with(QUERY_HISTORY_SQL)

    def test_no_exclude_patterns_returns_all_queries(self):
        db = _duckdb_with_history()
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


def _database(name: str, database_name: str | None = None, **attributes) -> MagicMock:
    database = MagicMock(**attributes)
    database.name = name
    if database_name is not None:
        database.get_database_name.return_value = database_name
    return database


def _duckdb_database(name: str) -> MagicMock:
    return _database(name, name, type="duckdb", templates=COLUMNS_TEMPLATES)


def _duckdb_with_history(**overrides) -> DuckDBConfig:
    return DuckDBConfig(name="duck", path=":memory:", query_history_sql=QUERY_HISTORY_SQL, **overrides)


@contextmanager
def _captured_console() -> Iterator[tuple[Console, StringIO]]:
    output = StringIO()
    console = Console(file=output, force_terminal=False)
    with patch(f"{PROVIDER_MODULE}.console", console), patch.object(UI, "_console", console):
        yield console, output
