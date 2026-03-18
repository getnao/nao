"""Integration tests for the database sync pipeline against a real ClickHouse database.

Connection is configured via environment variables:
    CLICKHOUSE_HOST, CLICKHOUSE_PORT (default 8123), CLICKHOUSE_USER, CLICKHOUSE_PASSWORD,
    CLICKHOUSE_SECURE (optional). Database is created per test module.

The test suite is skipped entirely when CLICKHOUSE_HOST is not set.

With docker-compose.test.yml:
    docker compose -f docker-compose.test.yml up -d
    cd cli && cp tests/nao_core/commands/sync/integration/.env.example \
         tests/nao_core/commands/sync/integration/.env
    uv run pytest tests/nao_core/commands/sync/integration/test_clickhouse.py -v
"""

import os
import re
import uuid
from pathlib import Path

import ibis
import pytest
from rich.progress import Progress

from nao_core.commands.sync.providers.databases.provider import sync_database
from nao_core.config.databases.base import DatabaseAccessor
from nao_core.config.databases.clickhouse import ClickHouseConfig

from .base import BaseSyncIntegrationTests, SyncTestSpec

CLICKHOUSE_HOST = os.environ.get("CLICKHOUSE_HOST")

pytestmark = pytest.mark.skipif(
    CLICKHOUSE_HOST is None,
    reason="CLICKHOUSE_HOST not set — skipping ClickHouse integration tests",
)


def _split_sql_statements(sql_content: str) -> list[str]:
    """Split a SQL script into individual statements.

    The fixture uses multi-line SQL with occasional trailing spaces after ';'.
    Splitting on `";\\n"` misses those statements, so use a whitespace-tolerant splitter.
    """
    parts = re.split(r";\s*(?:\n|$)", sql_content)
    return [part.strip() for part in parts if part.strip()]


def _clickhouse_connect(database: str = "default"):
    port = os.environ.get("CLICKHOUSE_PORT", "8123")
    secure = (os.environ.get("CLICKHOUSE_SECURE", "false") or "false").lower() in ("true", "1", "yes")
    return ibis.clickhouse.connect(
        host=os.environ["CLICKHOUSE_HOST"],
        port=int(port),
        database=database,
        user=os.environ.get("CLICKHOUSE_USER", "default"),
        password=os.environ.get("CLICKHOUSE_PASSWORD", ""),
        secure=secure,
        connect_timeout=15,
        send_receive_timeout=60,
    )


@pytest.fixture(scope="module")
def temp_database():
    """Create a temporary database, populate it with test data, then clean up."""
    conn = _clickhouse_connect("default")
    try:
        # Drop any leftover nao_unit_tests_* DBs from previous runs so get_schemas returns only ours
        list_db = getattr(conn, "list_databases", None)
        if list_db:
            try:
                for name in list_db():
                    if name.startswith("nao_unit_tests_"):
                        conn.raw_sql(f"DROP DATABASE IF EXISTS `{name}`")
            except Exception:
                pass
        conn.disconnect()
    except Exception:
        conn.disconnect()
        raise

    db_name = f"nao_unit_tests_{uuid.uuid4().hex[:8].lower()}"
    conn = _clickhouse_connect("default")
    try:
        conn.raw_sql(f"CREATE DATABASE IF NOT EXISTS `{db_name}`")
        conn.disconnect()
    except Exception:
        conn.disconnect()
        raise

    conn = _clickhouse_connect(db_name)
    try:
        sql_file = Path(__file__).parent / "dml" / "clickhouse.sql"
        sql_content = sql_file.read_text()

        for statement in _split_sql_statements(sql_content):
            conn.raw_sql(statement)

        # So test_sync_all_schemas passes: "default" DB must have spec.another_table so it gets synced
        conn_default = _clickhouse_connect("default")
        try:
            conn_default.raw_sql("CREATE TABLE IF NOT EXISTS nonexistent (id UInt32) ENGINE = MergeTree() ORDER BY id;")
            conn_default.disconnect()
        except Exception:
            conn_default.disconnect()
            raise

        yield db_name

    finally:
        conn.disconnect()
        conn = _clickhouse_connect("default")
        try:
            conn.raw_sql(f"DROP DATABASE IF EXISTS `{db_name}`")
        except Exception:
            pass
        conn.disconnect()


@pytest.fixture(scope="module")
def db_config(temp_database):
    """Build a ClickHouseConfig from environment variables using the temporary database."""
    port = os.environ.get("CLICKHOUSE_PORT", "8123")
    secure = (os.environ.get("CLICKHOUSE_SECURE", "false") or "false").lower() in ("true", "1", "yes")
    return ClickHouseConfig(
        name="test-clickhouse",
        host=os.environ["CLICKHOUSE_HOST"],
        port=int(port),
        database=temp_database,
        user=os.environ.get("CLICKHOUSE_USER", "default"),
        password=os.environ.get("CLICKHOUSE_PASSWORD", ""),
        secure=secure,
        connect_timeout=15,
        send_receive_timeout=60,
        include=[f"{temp_database}.*"],
        accessors=list(DatabaseAccessor),
    )


@pytest.fixture(scope="module")
def spec(temp_database):
    return SyncTestSpec(
        db_type="clickhouse",
        primary_schema=temp_database,
        users_column_assertions=(
            "# users",
            f"**Dataset:** `{temp_database}`",
            "## Columns (4)",
            "- id",
            "- name",
            "- email",
            "- active",
        ),
        orders_column_assertions=(
            "# orders",
            f"**Dataset:** `{temp_database}`",
            "## Columns (3)",
            "- id",
            "- user_id",
            "- amount",
        ),
        # description.md: users has a table comment (see COMMENT in dml/clickhouse.sql), orders has none
        users_table_description="User accounts and profile data",
        orders_table_description=None,
        users_preview_rows=[
            {"id": 1, "name": "Alice", "email": "alice@example.com", "active": 1},
            {"id": 2, "name": "Bob", "email": None, "active": 0},
            {"id": 3, "name": "Charlie", "email": "charlie@example.com", "active": 1},
        ],
        orders_preview_rows=[
            {"id": 1, "user_id": 1, "amount": 99.99},
            {"id": 2, "user_id": 1, "amount": 24.5},
        ],
        users_profiling_rows=[
            {
                "column": "id",
                "type": "UInt32",
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
                "type": "String",
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
                "type": "Nullable(String)",
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
                "type": "UInt8",
                "total_count": 3,
                "null_count": 0,
                "null_percentage": 0.0,
                "distinct_count": 2,
                "min": 0,
                "max": 1,
                "mean": 0.6667,
                "stddev": 0.4714,
            },
        ],
        orders_profiling_rows=[
            {
                "column": "id",
                "type": "UInt32",
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
                "type": "UInt32",
                "total_count": 2,
                "null_count": 0,
                "null_percentage": 0.0,
                "distinct_count": 1,
                "top_values": [{"value": 1, "count": 2}],
            },
            {
                "column": "amount",
                "type": "Float64",
                "total_count": 2,
                "null_count": 0,
                "null_percentage": 0.0,
                "distinct_count": 2,
                "min": 24.5,
                "max": 99.99,
                "mean": 62.245,
                "stddev": 37.745,
            },
        ],
        sort_rows=True,
        row_id_key="id",
        # ClickHouse does not expose an explicit single-schema config field.
        schema_field=None,
        another_schema="default",
        another_table="nonexistent",
    )


@pytest.mark.timeout(120)
class TestClickHouseSyncIntegration(BaseSyncIntegrationTests):
    """Verify the sync pipeline produces correct output against a live ClickHouse database."""

    def test_creates_expected_directory_tree(self, synced, spec):
        """Override base expectation: ClickHouse also generates ai_summary.md."""
        state, output, config = synced
        base = self._base_path(output, config, spec)

        assert base.is_dir()

        expected_files = ["ai_summary.md", "columns.md", "description.md", "preview.md", "profiling.md"]

        for table in (spec.users_table, spec.orders_table):
            table_dir = base / f"table={table}"
            assert table_dir.is_dir()
            files = sorted(f.name for f in table_dir.iterdir())
            assert files == sorted(expected_files)

        # "another" schema was NOT synced (only when provider has one)
        if spec.another_schema:
            another_dir = (
                output
                / f"type={spec.db_type}"
                / f"database={config.get_database_name()}"
                / f"schema={spec.another_schema}"
            )
            assert not another_dir.exists()

    def test_sync_state_tracks_schemas_and_tables(self, synced, spec):
        """Sync state reflects expected tables for various engine types."""
        state, _, _ = synced
        assert state.schemas_synced == 1
        assert spec.primary_schema in state.synced_schemas

        synced_tables = state.synced_tables[spec.primary_schema]
        # Core tables used by shared tests
        assert spec.users_table in synced_tables
        assert spec.orders_table in synced_tables

        # Extra tables exercising different engine types (users_dict is a dictionary)
        expected_engine_tables = {
            "orders_summing",  # SummingMergeTree
            "events_replacing",  # ReplacingMergeTree
            "agg_orders",  # AggregatingMergeTree
            "kafka_events",  # Kafka engine (no direct SELECT)
            "orders_by_user_mv_target",  # SummingMergeTree target for materialized view
            "users_dict",  # Dictionary (CREATE DICTIONARY)
        }
        assert expected_engine_tables.issubset(set(synced_tables))
        assert state.tables_synced >= len(expected_engine_tables) + 2  # + users, orders

    def test_exclude_filter(self, tmp_path_factory, db_config, spec):
        """Tables matching exclude patterns should be skipped (excluding orders leaves other tables)."""
        schema = spec.effective_filter_schema
        config = db_config.model_copy(update={"exclude": [f"{schema}.{spec.orders_table}"]})

        output = tmp_path_factory.mktemp(f"{spec.db_type}_exclude")
        with Progress(transient=True) as progress:
            state = sync_database(config, output, progress)

        base = self._base_path(output, config, spec)
        assert (base / f"table={spec.users_table}").is_dir()
        assert not (base / f"table={spec.orders_table}").exists()
        # One schema synced; excluding orders still leaves users + engine tables (e.g. orders_summing, events_replacing)
        assert state.tables_synced >= 2

    def test_dictionary_sync_generates_description_with_index_metadata(self, synced, spec):
        """Sync must generate description.md containing dictionary index metadata."""
        _, output, config = synced
        base = self._base_path(output, config, spec)
        table_dir = base / "table=users_dict"
        assert table_dir.is_dir(), "users_dict table dir should exist after sync"
        description_md = table_dir / "description.md"
        assert description_md.exists(), "description.md must be generated for dictionary"
        idx_content = description_md.read_text()

        # Ensure description contains the CREATE DICTIONARY DDL with SOURCE and LAYOUT
        lower_content = idx_content.lower()
        assert "create dictionary" in lower_content, "description.md should contain CREATE DICTIONARY DDL"
        assert "source(" in lower_content and "layout(" in lower_content, (
            "description.md should contain dictionary SOURCE and LAYOUT"
        )
        # We intentionally render a concise summary, not full dictionary column DDL.
        assert "`email` nullable(string)" not in lower_content

    def test_projections_appear_in_description_indexes(self, synced, spec):
        """Indexes section should include projection and key storage metadata."""
        _, output, config = synced
        base = self._base_path(output, config, spec)
        table_dir = base / f"table={spec.orders_table}"
        description_md = table_dir / "description.md"
        assert description_md.exists(), "description.md must exist for orders table"
        content = description_md.read_text().lower()

        assert "engine = mergetree" in content
        assert "order by id" in content
        assert "projection orders_by_user_proj" in content, (
            "description.md indexes section should include the projection name for orders"
        )
        assert "order by user_id" in content, (
            "description.md indexes section should include projection sort key for orders"
        )
        # We intentionally render a concise summary, not full column DDL.
        assert "`amount` float64" not in content

    def test_projection_is_not_synced_as_a_table(self, synced, spec):
        """ClickHouse projections should appear in metadata, not as standalone synced tables."""
        state, output, config = synced
        base = self._base_path(output, config, spec)

        assert "orders_by_user_proj" not in state.synced_tables[spec.primary_schema]
        assert not (base / "table=orders_by_user_proj").exists()

    def test_columns_md_includes_default_alias_materialized_metadata(self, synced, spec):
        """columns.md should include DEFAULT / MATERIALIZED / ALIAS expressions when present."""
        _, output, config = synced
        content = self._read_table_file(output, config, spec, "computed_columns", "columns.md").lower()

        assert "default now()" in content
        assert "materialized toyyyymmdd(created_at)" in content
        assert "alias tostring(id)" in content

    def test_columns_md_preserves_low_cardinality_types(self, synced, spec):
        """columns.md should preserve native ClickHouse LowCardinality type wrappers."""
        _, output, config = synced
        content = self._read_table_file(output, config, spec, "low_cardinality_columns", "columns.md").lower()

        assert "lowcardinality(string)" in content

    def test_mv_target_table_indexes_include_key_metadata(self, synced, spec):
        """Materialized-view target table should expose useful key/index metadata."""
        _, output, config = synced
        base = self._base_path(output, config, spec)
        table_dir = base / "table=orders_by_user_mv_target"
        description_md = table_dir / "description.md"
        assert description_md.exists(), "description.md must exist for orders_by_user_mv_target"
        content = description_md.read_text().lower()

        # Projections are defined on orders in the fixture; the MV target still needs clear key metadata.
        assert "engine = summingmergetree" in content
        assert "primary key user_id" in content
        assert "order by user_id" in content

    def test_sync_all_schemas(self, tmp_path_factory, db_config, spec):
        """Overrides base test to test because clickhouse ddl has multiple tables.
        When schema is not specified, all schemas (temp DB + default with nonexistent) are synced."""
        if spec.schema_field is None:
            pytest.skip("Provider does not support multi-schema test")

        config = db_config.model_copy(update={spec.schema_field: None})

        output = tmp_path_factory.mktemp(f"{spec.db_type}_all_schemas")
        with Progress(transient=True) as progress:
            state = sync_database(config, output, progress)

        db_name = config.get_database_name()

        primary_base = output / f"type={spec.db_type}" / f"database={db_name}" / f"schema={spec.primary_schema}"
        assert primary_base.is_dir()
        assert (primary_base / f"table={spec.users_table}").is_dir()
        assert (primary_base / f"table={spec.orders_table}").is_dir()

        expected_files = ["ai_summary.md", "columns.md", "description.md", "preview.md"]

        for table in (spec.users_table, spec.orders_table):
            files = sorted(f.name for f in (primary_base / f"table={table}").iterdir())
            assert files == sorted(expected_files)

        another_base = output / f"type={spec.db_type}" / f"database={db_name}" / f"schema={spec.another_schema}"
        assert another_base.is_dir()
        assert (another_base / f"table={spec.another_table}").is_dir()

        files = sorted(f.name for f in (another_base / f"table={spec.another_table}").iterdir())
        assert files == sorted(expected_files)

        assert state.schemas_synced >= 2
        assert state.tables_synced >= 3  # primary has many tables + default has nonexistent
        assert spec.primary_schema in state.synced_schemas
        assert spec.another_schema in state.synced_schemas
        assert spec.users_table in state.synced_tables[spec.primary_schema]
        assert spec.orders_table in state.synced_tables[spec.primary_schema]
        assert spec.another_table in state.synced_tables[spec.another_schema]
