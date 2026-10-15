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
import uuid

import pytest

from nao_core.config.databases.base import DatabaseAccessor
from nao_core.config.databases.clickhouse import ClickHouseConfig

from .test_clickhouse import (
    _ClickHouseSyncMixin,
    clickhouse_connection_settings,
    clickhouse_dml_statements,
    clickhouse_spec,
)

CLICKHOUSE_HOST = os.environ.get("CLICKHOUSE_HOST")

pytestmark = pytest.mark.skipif(
    CLICKHOUSE_HOST is None,
    reason="CLICKHOUSE_HOST not set — skipping ClickHouse native-protocol integration tests",
)


def _native_connect(database: str = "default"):
    """Build a native-protocol connection using ``ClickHouseConfig`` itself.

    Using the public API here is intentional — it exercises the dispatch in
    ``ClickHouseConfig.connect`` while we set up the test schema.
    """
    config = ClickHouseConfig(
        name="native-bootstrap",
        protocol="native",
        database=database,
        **_native_connection_settings(),
    )
    return config.connect()


def _native_connection_settings() -> dict:
    return clickhouse_connection_settings("CLICKHOUSE_NATIVE_PORT", "9000")


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
        for statement in clickhouse_dml_statements():
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
    return ClickHouseConfig(
        name="test-clickhouse-native",
        protocol="native",
        database=temp_database,
        include=[f"{temp_database}.*"],
        accessors=list(DatabaseAccessor),
        **_native_connection_settings(),
    )


@pytest.fixture(scope="module")
def spec(temp_database):
    """Same expectations as the HTTP suite — the native shim must match output byte-for-byte."""
    return clickhouse_spec(temp_database)


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
