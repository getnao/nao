"""Shared base class and spec for database sync integration tests.

Each provider test file defines fixtures (`db_config`, `spec`) and a test class
that inherits from `BaseSyncIntegrationTests` to get all shared assertions for free.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path

import pytest
from rich.progress import Progress

from nao_core.commands.sync.providers.databases.provider import sync_database

DML_DIR = Path(__file__).parent / "dml"

USERS_PREVIEW_ROWS = [
    {"id": 1, "name": "Alice", "email": "alice@example.com", "active": True},
    {"id": 2, "name": "Bob", "email": None, "active": False},
    {"id": 3, "name": "Charlie", "email": "charlie@example.com", "active": True},
]

ORDERS_PREVIEW_ROWS = [
    {"id": 1, "user_id": 1, "amount": 99.99},
    {"id": 2, "user_id": 1, "amount": 24.5},
]

USERS_PROFILING_ROWS = [
    {
        "column": "id",
        "type": "int32",
        "total_count": 3,
        "null_count": 0,
        "null_percentage": 0.0,
        "distinct_count": 3,
        "min": 1,
        "max": 3,
        "mean": 2.0,
        "stddev": 0.8165,
    },
    {
        "column": "name",
        "type": "string",
        "total_count": 3,
        "null_count": 0,
        "null_percentage": 0.0,
        "distinct_count": 3,
        "top_values": [
            {"value": "Alice", "count": 1},
            {"value": "Bob", "count": 1},
            {"value": "Charlie", "count": 1},
        ],
    },
    {
        "column": "email",
        "type": "string",
        "total_count": 3,
        "null_count": 1,
        "null_percentage": 33.33,
        "distinct_count": 2,
        "top_values": [
            {"value": "alice@example.com", "count": 1},
            {"value": "charlie@example.com", "count": 1},
        ],
    },
    {
        "column": "active",
        "type": "boolean",
        "total_count": 3,
        "null_count": 0,
        "null_percentage": 0.0,
        "distinct_count": 2,
        "top_values": [{"value": True, "count": 2}, {"value": False, "count": 1}],
    },
]

ORDERS_PROFILING_ROWS = [
    {
        "column": "id",
        "type": "int32",
        "total_count": 2,
        "null_count": 0,
        "null_percentage": 0.0,
        "distinct_count": 2,
        "min": 1,
        "max": 2,
        "mean": 1.5,
        "stddev": 0.5,
    },
    {
        "column": "user_id",
        "type": "int32",
        "total_count": 2,
        "null_count": 0,
        "null_percentage": 0.0,
        "distinct_count": 1,
        "top_values": [{"value": 1, "count": 2}],
    },
    {
        "column": "amount",
        "type": "float64",
        "total_count": 2,
        "null_count": 0,
        "null_percentage": 0.0,
        "distinct_count": 2,
        "min": 24.5,
        "max": 99.99,
        "mean": 62.245,
        "stddev": 37.745,
    },
]

INTEGER_ACTIVE_PROFILE = {
    "column": "active",
    "total_count": 3,
    "null_count": 0,
    "null_percentage": 0.0,
    "distinct_count": 2,
    "min": 0,
    "max": 1,
    "mean": 0.6667,
    "stddev": 0.4714,
}


def with_column_types(rows: list[dict], column_types: dict[str, str]) -> list[dict]:
    return [{**row, "type": column_types.get(row["column"], row["type"])} for row in rows]


def with_integer_active(rows: list[dict], active_type: str) -> list[dict]:
    """Profiles for engines that store the `active` flag as a 0/1 integer."""
    return [{**INTEGER_ACTIVE_PROFILE, "type": active_type} if row["column"] == "active" else row for row in rows]


def dml_statements(filename: str, **placeholders: object) -> list[str]:
    """Statements of a DML script; only formatted when placeholders are given, as scripts may contain braces."""
    sql = (DML_DIR / filename).read_text()
    if placeholders:
        sql = sql.format(**placeholders)
    return [statement.strip() for statement in sql.split(";") if statement.strip()]


@dataclass(frozen=True)
class SyncTestSpec:
    """Provider-specific expected values for database sync integration tests."""

    db_type: str
    primary_schema: str

    # Table names as they appear in output paths and state
    users_table: str = "users"
    orders_table: str = "orders"

    # Strings expected in columns.md (checked with `in content`)
    users_column_assertions: tuple[str, ...] = ()
    orders_column_assertions: tuple[str, ...] = ()

    # Expected table descriptions (None means "no description" path is tested)
    users_table_description: str | None = None
    orders_table_description: str | None = None

    # Expected preview rows (sorted by row_id_key when sort_rows is True)
    users_preview_rows: list[dict] = field(default_factory=USERS_PREVIEW_ROWS.copy)
    orders_preview_rows: list[dict] = field(default_factory=ORDERS_PREVIEW_ROWS.copy)

    # Expected profiling rows (sorted by column when sort_rows is True)
    users_profiling_rows: list[dict] = field(default_factory=USERS_PROFILING_ROWS.copy)
    orders_profiling_rows: list[dict] = field(default_factory=ORDERS_PROFILING_ROWS.copy)

    sort_rows: bool = False
    row_id_key: str = "id"

    # Schema prefix for include/exclude filter patterns (defaults to primary_schema)
    filter_schema: str | None = None

    # Multi-schema test (optional — skipped when schema_field is None)
    schema_field: str | None = None
    another_schema: str | None = None
    another_table: str | None = None

    # Total tables in the primary schema (override when extra tables exist, e.g. events)
    primary_table_count: int = 2

    # When partition filter is required, the table name of the partition filter table (BigQuery only)
    events_table: str = "events"

    # Column name expected to exist on the users table that exercises exclude_columns.
    # Set to None to skip the exclude_columns integration test for this provider.
    excluded_column_name: str | None = "email"

    @property
    def effective_filter_schema(self) -> str:
        return self.filter_schema or self.primary_schema


class BaseSyncIntegrationTests:
    """Shared sync integration tests.

    Subclasses must provide `synced`, `db_config`, and `spec` fixtures
    (typically via module-level fixtures in each test file).
    """

    EXPECTED_TABLE_FILES = ["annotations.md", "columns.md", "preview.md", "profiling.md", "query_history.md"]

    # ── helpers ──────────────────────────────────────────────────────

    def _base_path(self, output: Path, config, spec: SyncTestSpec) -> Path:
        return self._schema_path(output, config, spec, spec.primary_schema)

    def _schema_path(self, output: Path, config, spec: SyncTestSpec, schema: str) -> Path:
        return output / f"type={spec.db_type}" / f"database={config.get_database_name()}" / f"schema={schema}"

    def _read_table_file(self, output, config, spec, table, filename):
        return (self._base_path(output, config, spec) / f"table={table}" / filename).read_text()

    def _parse_preview_rows(self, content: str) -> list[dict]:
        lines = [line for line in content.splitlines() if line.startswith("- {")]
        return [json.loads(line[2:]) for line in lines]

    # ── directory tree ───────────────────────────────────────────────

    def test_creates_expected_directory_tree(self, synced, spec):
        state, output, config = synced
        base = self._base_path(output, config, spec)

        assert base.is_dir()

        for table in (spec.users_table, spec.orders_table):
            table_dir = base / f"table={table}"
            assert table_dir.is_dir()
            files = sorted(f.name for f in table_dir.iterdir())
            assert files == sorted(self.EXPECTED_TABLE_FILES)

        # "another" schema was NOT synced (only when provider has one)
        if spec.another_schema:
            assert not self._schema_path(output, config, spec, spec.another_schema).exists()

    # ── columns.md ───────────────────────────────────────────────────

    def test_columns_md_users(self, synced, spec):
        _, output, config = synced
        content = self._read_table_file(output, config, spec, spec.users_table, "columns.md")

        for expected in spec.users_column_assertions:
            assert expected in content

        assert "## Table Metadata" in content
        assert "| **Row Count** | 3 |" in content
        assert "## Columns (" in content

        if spec.users_table_description:
            assert spec.users_table_description in content
        else:
            assert "_No description available._" in content

    def test_columns_md_orders(self, synced, spec):
        _, output, config = synced
        content = self._read_table_file(output, config, spec, spec.orders_table, "columns.md")

        for expected in spec.orders_column_assertions:
            assert expected in content

        assert "## Table Metadata" in content
        assert "| **Row Count** | 2 |" in content
        assert "## Columns (" in content

        if spec.orders_table_description:
            assert spec.orders_table_description in content
        else:
            assert "_No description available._" in content

    # ── query_history.md ────────────────────────────────────────────

    def test_query_history_md_users(self, synced, spec):
        _, output, config = synced
        content = self._read_table_file(output, config, spec, spec.users_table, "query_history.md")

        assert "_No query history found for this table._" in content

    def test_query_history_md_orders(self, synced, spec):
        _, output, config = synced
        content = self._read_table_file(output, config, spec, spec.orders_table, "query_history.md")

        assert "_No query history found for this table._" in content

    # ── preview.md ───────────────────────────────────────────────────

    def test_preview_md_users(self, synced, spec):
        _, output, config = synced
        content = self._read_table_file(output, config, spec, spec.users_table, "preview.md")

        assert "## Rows (3)" in content

        rows = self._parse_preview_rows(content)
        assert len(rows) == 3

        if spec.sort_rows:
            rows = sorted(rows, key=lambda r: r[spec.row_id_key])

        assert rows == spec.users_preview_rows

    def test_preview_md_orders(self, synced, spec):
        _, output, config = synced
        content = self._read_table_file(output, config, spec, spec.orders_table, "preview.md")

        rows = self._parse_preview_rows(content)
        assert len(rows) == 2

        if spec.sort_rows:
            rows = sorted(rows, key=lambda r: r[spec.row_id_key])

        assert rows == spec.orders_preview_rows

    # ── profiling.md ───────────────────────────────────────────────────

    def test_profiling_md_users(self, synced, spec):
        _, output, config = synced
        content = self._read_table_file(output, config, spec, spec.users_table, "profiling.md")

        assert "## Column Profiles (JSONL)" in content

        rows = self._parse_preview_rows(content)
        assert len(rows) == 4

        assert rows == spec.users_profiling_rows

    def test_profiling_md_orders(self, synced, spec):
        _, output, config = synced
        content = self._read_table_file(output, config, spec, spec.orders_table, "profiling.md")

        assert "## Column Profiles (JSONL)" in content

        rows = self._parse_preview_rows(content)
        assert len(rows) == 3

        assert rows == spec.orders_profiling_rows

    # ── sync state ───────────────────────────────────────────────────

    def test_sync_state_tracks_schemas_and_tables(self, synced, spec):
        state, _, _ = synced

        assert state.schemas_synced == 1
        assert state.tables_synced == spec.primary_table_count
        assert spec.primary_schema in state.synced_schemas
        assert spec.users_table in state.synced_tables[spec.primary_schema]
        assert spec.orders_table in state.synced_tables[spec.primary_schema]

    # ── execute_sql ────────────────────────────────────────────────────

    def test_execute_sql_returns_dataframe(self, db_config, spec):
        """execute_sql should return a pandas DataFrame with correct data."""
        schema = spec.primary_schema
        table = spec.users_table
        df = db_config.execute_sql(f"SELECT * FROM {schema}.{table} ORDER BY 1")
        assert len(df) == 3
        assert len(df.columns) == 4

    def test_execute_sql_with_filter(self, db_config, spec):
        """execute_sql should honour a WHERE clause."""
        schema = spec.primary_schema
        table = spec.orders_table
        df = db_config.execute_sql(f"SELECT * FROM {schema}.{table} WHERE 1=1")
        assert len(df) == 2

    def test_execute_sql_with_aggregation(self, db_config, spec):
        """execute_sql should handle aggregate queries."""
        schema = spec.primary_schema
        table = spec.users_table
        df = db_config.execute_sql(f"SELECT COUNT(*) AS cnt FROM {schema}.{table}")
        assert len(df) == 1
        assert int(df.iloc[0, 0]) == 3

    # ── include / exclude filters ────────────────────────────────────

    def test_include_filter(self, tmp_path_factory, db_config, spec):
        """Only tables matching include patterns should be synced."""
        schema = spec.effective_filter_schema
        config = db_config.model_copy(update={"include": [f"{schema}.{spec.users_table}"]})

        output = tmp_path_factory.mktemp(f"{spec.db_type}_include")
        with Progress(transient=True) as progress:
            state = sync_database(config, output, progress)

        base = self._base_path(output, config, spec)
        assert (base / f"table={spec.users_table}").is_dir()
        assert not (base / f"table={spec.orders_table}").exists()
        assert state.tables_synced == 1

    def test_exclude_filter(self, tmp_path_factory, db_config, spec):
        """Tables matching exclude patterns should be skipped."""
        schema = spec.effective_filter_schema
        config = db_config.model_copy(update={"exclude": [f"{schema}.{spec.orders_table}"]})

        output = tmp_path_factory.mktemp(f"{spec.db_type}_exclude")
        with Progress(transient=True) as progress:
            state = sync_database(config, output, progress)

        base = self._base_path(output, config, spec)
        assert (base / f"table={spec.users_table}").is_dir()
        assert not (base / f"table={spec.orders_table}").exists()
        assert state.tables_synced == spec.primary_table_count - 1

    def test_exclude_columns_filter(self, tmp_path_factory, db_config, spec):
        """Columns matching exclude_columns patterns should be hidden from output."""
        if not spec.excluded_column_name:
            pytest.skip("Provider spec does not declare a column to exclude")

        config = db_config.model_copy(update={"exclude_columns": [f"*.*.{spec.excluded_column_name}"]})

        output = tmp_path_factory.mktemp(f"{spec.db_type}_exclude_columns")
        with Progress(transient=True) as progress:
            sync_database(config, output, progress)

        users_columns = self._read_table_file(output, config, spec, spec.users_table, "columns.md")
        assert f"- {spec.excluded_column_name} (" not in users_columns

        preview_content = self._read_table_file(output, config, spec, spec.users_table, "preview.md")
        for row in self._parse_preview_rows(preview_content):
            assert spec.excluded_column_name not in row

        profiling_content = self._read_table_file(output, config, spec, spec.users_table, "profiling.md")
        for row in self._parse_preview_rows(profiling_content):
            assert row.get("column") != spec.excluded_column_name

    # ── check_connection ──────────────────────────────────────────────

    def test_check_connection_succeeds(self, db_config):
        """check_connection should report success against a live database."""
        ok, message = db_config.check_connection()

        assert ok is True
        assert "Connected successfully" in message

    # ── get_schemas ───────────────────────────────────────────────────

    def test_get_schemas_with_explicit_schema(self, db_config, spec):
        """When the config specifies a schema, get_schemas returns only that schema."""
        if spec.schema_field is None:
            pytest.skip("Provider does not support explicit schema configuration")

        conn = db_config.connect()
        schemas = db_config.get_schemas(conn)

        assert schemas == [spec.primary_schema]

    def test_get_schemas_without_explicit_schema(self, db_config, spec):
        """When no schema is specified, get_schemas returns all user schemas."""
        if spec.schema_field is None:
            pytest.skip("Provider does not support multi-schema test")

        config = db_config.model_copy(update={spec.schema_field: None})
        conn = config.connect()
        schemas = config.get_schemas(conn)

        assert spec.primary_schema in schemas
        assert spec.another_schema in schemas

    # ── multi-schema sync ────────────────────────────────────────────

    def test_sync_all_schemas(self, tmp_path_factory, db_config, spec):
        """When schema is not specified, all schemas should be synced."""
        if spec.schema_field is None:
            pytest.skip("Provider does not support multi-schema test")

        config = db_config.model_copy(
            update={
                spec.schema_field: None,
                "include": [
                    f"{spec.primary_schema}.*",
                    f"{spec.another_schema}.*",
                ],
            }
        )

        output = tmp_path_factory.mktemp(f"{spec.db_type}_all_schemas")
        with Progress(transient=True) as progress:
            state = sync_database(config, output, progress)

        expected_files = sorted(self.EXPECTED_TABLE_FILES)

        # Primary schema tables
        primary_base = self._base_path(output, config, spec)
        assert primary_base.is_dir()
        assert (primary_base / f"table={spec.users_table}").is_dir()
        assert (primary_base / f"table={spec.orders_table}").is_dir()

        for table in (spec.users_table, spec.orders_table):
            files = sorted(f.name for f in (primary_base / f"table={table}").iterdir())
            assert files == expected_files

        # Another schema
        another_base = self._schema_path(output, config, spec, spec.another_schema)
        assert another_base.is_dir()
        assert (another_base / f"table={spec.another_table}").is_dir()

        files = sorted(f.name for f in (another_base / f"table={spec.another_table}").iterdir())
        assert files == expected_files

        # State
        assert state.schemas_synced == 2
        assert state.tables_synced == spec.primary_table_count + 1
        assert spec.primary_schema in state.synced_schemas
        assert spec.another_schema in state.synced_schemas
        assert spec.users_table in state.synced_tables[spec.primary_schema]
        assert spec.orders_table in state.synced_tables[spec.primary_schema]
        assert spec.another_table in state.synced_tables[spec.another_schema]
