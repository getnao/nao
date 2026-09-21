"""End-to-end integration tests for ClickHouse sync over the native TCP protocol.

Mirrors the HTTP integration suite in ``test_clickhouse.py`` but uses
``ClickHouseConfig(protocol="native")`` and connects to the native port
(9000 by default — override with ``CLICKHOUSE_NATIVE_PORT``).

Skipped when ``CLICKHOUSE_HOST`` is not set (same gating as the HTTP suite).
With ``docker-compose.test.yml`` the native port is already exposed::

    docker compose -f docker-compose.test.yml up -d
    cd cli && cp tests/nao_core/commands/sync/integration/.env.example \
         tests/nao_core/commands/sync/integration/.env
    uv run pytest tests/nao_core/commands/sync/integration/test_clickhouse_native.py -v
"""

from __future__ import annotations

import os
import re
import uuid
from pathlib import Path

import pytest

from nao_core.config.databases.base import DatabaseAccessor
from nao_core.config.databases.clickhouse import ClickHouseConfig

from .base import SyncTestSpec
from .test_clickhouse import _ClickHouseSyncMixin

CLICKHOUSE_HOST = os.environ.get("CLICKHOUSE_HOST")

pytestmark = pytest.mark.skipif(
    CLICKHOUSE_HOST is None,
    reason="CLICKHOUSE_HOST not set — skipping ClickHouse native-protocol integration tests",
)


def _split_sql_statements(sql_content: str) -> list[str]:
    """Whitespace-tolerant SQL statement splitter (same logic as the HTTP suite)."""
    parts = re.split(r";\s*(?:\n|$)", sql_content)
    return [part.strip() for part in parts if part.strip()]


def _native_connect(database: str = "default"):
    """Build a native-protocol connection using ``ClickHouseConfig`` itself.

    Using the public API here is intentional — it exercises the dispatch in
    ``ClickHouseConfig.connect`` while we set up the test schema.
    """
    port = int(os.environ.get("CLICKHOUSE_NATIVE_PORT", "9000"))
    secure = (os.environ.get("CLICKHOUSE_SECURE", "false") or "false").lower() in ("true", "1", "yes")
    config = ClickHouseConfig(
        name="native-bootstrap",
        host=os.environ["CLICKHOUSE_HOST"],
        protocol="native",
        port=port,
        database=database,
        user=os.environ.get("CLICKHOUSE_USER", "default"),
        password=os.environ.get("CLICKHOUSE_PASSWORD", ""),
        secure=secure,
        connect_timeout=15,
        send_receive_timeout=60,
    )
    return config.connect()


@pytest.fixture(scope="module")
def temp_database():
    """Create a temporary database, seed it via native TCP, then clean up."""
    conn = _native_connect("default")
    try:
        for name in conn.list_databases():
            if name.startswith("nao_native_tests_"):
                conn.raw_sql(f"DROP DATABASE IF EXISTS `{name}`")
    finally:
        conn.disconnect()

    db_name = f"nao_native_tests_{uuid.uuid4().hex[:8].lower()}"

    conn = _native_connect("default")
    try:
        conn.raw_sql(f"CREATE DATABASE IF NOT EXISTS `{db_name}`")
    finally:
        conn.disconnect()

    conn = _native_connect(db_name)
    try:
        sql_file = Path(__file__).parent / "dml" / "clickhouse.sql"
        for statement in _split_sql_statements(sql_file.read_text()):
            conn.raw_sql(statement)

        # Mirror the HTTP suite: ensure ``default`` has the ``another_table`` so
        # the multi-schema sync test in ``BaseSyncIntegrationTests`` is satisfied.
        bootstrap = _native_connect("default")
        try:
            bootstrap.raw_sql("CREATE TABLE IF NOT EXISTS nonexistent (id UInt32) ENGINE = MergeTree() ORDER BY id")
        finally:
            bootstrap.disconnect()

        yield db_name
    finally:
        conn.disconnect()
        cleanup = _native_connect("default")
        try:
            cleanup.raw_sql(f"DROP DATABASE IF EXISTS `{db_name}`")
        finally:
            cleanup.disconnect()


@pytest.fixture(scope="module")
def db_config(temp_database):
    """Build a ``protocol='native'`` ClickHouseConfig pointed at the temp DB."""
    port = int(os.environ.get("CLICKHOUSE_NATIVE_PORT", "9000"))
    secure = (os.environ.get("CLICKHOUSE_SECURE", "false") or "false").lower() in ("true", "1", "yes")
    return ClickHouseConfig(
        name="test-clickhouse-native",
        host=os.environ["CLICKHOUSE_HOST"],
        protocol="native",
        port=port,
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
    """Same expectations as the HTTP suite — the native shim must match output byte-for-byte."""
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
        schema_field=None,
        another_schema="default",
        another_table="nonexistent",
    )


@pytest.mark.timeout(120)
class TestClickHouseNativeSyncIntegration(_ClickHouseSyncMixin):
    """Verify the sync pipeline produces correct output over the native TCP protocol."""

    __test__ = True

    def test_connection_uses_native_backend(self, db_config) -> None:
        """Sanity check: the config must dispatch to the native backend, not Ibis."""
        from nao_core.config.databases._clickhouse_native import NativeClickHouseBackend

        conn = db_config.connect()
        try:
            assert isinstance(conn, NativeClickHouseBackend)
        finally:
            conn.disconnect()
