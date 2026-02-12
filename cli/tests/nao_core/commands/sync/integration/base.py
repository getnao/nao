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
    users_preview_rows: list[dict] = field(default_factory=list)
    orders_preview_rows: list[dict] = field(default_factory=list)
    sort_rows: bool = False
    row_id_key: str = "id"

    # Schema prefix for include/exclude filter patterns (defaults to primary_schema)
    filter_schema: str | None = None

    # Multi-schema test (optional — skipped when schema_field is None)
    schema_field: str | None = None
    another_schema: str | None = None
    another_table: str | None = None

    @property
    def effective_filter_schema(self) -> str:
        return self.filter_schema or self.primary_schema


class BaseSyncIntegrationTests:
    """Shared sync integration tests.

    Subclasses must provide `synced`, `db_config`, and `spec` fixtures
    (typically via module-level fixtures in each test file).
    """

    # ── helpers ──────────────────────────────────────────────────────

    def _base_path(self, output: Path, config, spec: SyncTestSpec) -> Path:
        return (
            output / f"type={spec.db_type}" / f"database={config.get_database_name()}" / f"schema={spec.primary_schema}"
        )

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
            assert files == ["columns.md", "description.md", "preview.md"]

        # "another" schema was NOT synced (only when provider has one)
        if spec.another_schema:
            another_dir = (
                output
                / f"type={spec.db_type}"
                / f"database={config.get_database_name()}"
                / f"schema={spec.another_schema}"
            )
            assert not another_dir.exists()

    # ── columns.md ───────────────────────────────────────────────────

    def test_columns_md_users(self, synced, spec):
        _, output, config = synced
        content = self._read_table_file(output, config, spec, spec.users_table, "columns.md")

        for expected in spec.users_column_assertions:
            assert expected in content

    def test_columns_md_orders(self, synced, spec):
        _, output, config = synced
        content = self._read_table_file(output, config, spec, spec.orders_table, "columns.md")

        for expected in spec.orders_column_assertions:
            assert expected in content

    # ── description.md ───────────────────────────────────────────────

    def test_description_md_users(self, synced, spec):
        _, output, config = synced
        content = self._read_table_file(output, config, spec, spec.users_table, "description.md")

        assert "## Table Metadata" in content
        assert "| **Row Count** | 3 |" in content
        assert "| **Column Count** | 4 |" in content

        if spec.users_table_description:
            assert spec.users_table_description in content
        else:
            assert "_No description available._" in content

    def test_description_md_orders(self, synced, spec):
        _, output, config = synced
        content = self._read_table_file(output, config, spec, spec.orders_table, "description.md")

        assert "| **Row Count** | 2 |" in content
        assert "| **Column Count** | 3 |" in content

        if spec.orders_table_description:
            assert spec.orders_table_description in content
        else:
            assert "_No description available._" in content

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

    # ── sync state ───────────────────────────────────────────────────

    def test_sync_state_tracks_schemas_and_tables(self, synced, spec):
        state, _, _ = synced

        assert state.schemas_synced == 1
        assert state.tables_synced == 2
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
        assert state.tables_synced == 1

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

        config = db_config.model_copy(update={spec.schema_field: None})

        output = tmp_path_factory.mktemp(f"{spec.db_type}_all_schemas")
        with Progress(transient=True) as progress:
            state = sync_database(config, output, progress)

        db_name = config.get_database_name()

        # Primary schema tables
        primary_base = output / f"type={spec.db_type}" / f"database={db_name}" / f"schema={spec.primary_schema}"
        assert primary_base.is_dir()
        assert (primary_base / f"table={spec.users_table}").is_dir()
        assert (primary_base / f"table={spec.orders_table}").is_dir()

        for table in (spec.users_table, spec.orders_table):
            files = sorted(f.name for f in (primary_base / f"table={table}").iterdir())
            assert files == ["columns.md", "description.md", "preview.md"]

        # Another schema
        another_base = output / f"type={spec.db_type}" / f"database={db_name}" / f"schema={spec.another_schema}"
        assert another_base.is_dir()
        assert (another_base / f"table={spec.another_table}").is_dir()

        files = sorted(f.name for f in (another_base / f"table={spec.another_table}").iterdir())
        assert files == ["columns.md", "description.md", "preview.md"]

        # State
        assert state.schemas_synced == 2
        assert state.tables_synced == 3
        assert spec.primary_schema in state.synced_schemas
        assert spec.another_schema in state.synced_schemas
        assert spec.users_table in state.synced_tables[spec.primary_schema]
        assert spec.orders_table in state.synced_tables[spec.primary_schema]
        assert spec.another_table in state.synced_tables[spec.another_schema]
