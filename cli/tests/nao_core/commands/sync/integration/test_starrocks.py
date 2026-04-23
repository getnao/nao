"""Integration tests for StarRocks sync using mysql-connector backend.

Required environment variables:
    STARROCKS_HOST, STARROCKS_USER
Optional:
    STARROCKS_PORT (default 9030), STARROCKS_PASSWORD

The test suite is skipped when STARROCKS_HOST is not set.
"""

import os
import uuid
from pathlib import Path

import pytest
from rich.progress import Progress

from nao_core.commands.sync.providers.databases.provider import sync_database
from nao_core.config.databases.starrocks import DEFAULT_CATALOG, StarRocksConfig

STARROCKS_HOST = os.environ.get("STARROCKS_HOST")

pytestmark = pytest.mark.skipif(STARROCKS_HOST is None, reason="STARROCKS_HOST not set - skipping StarRocks tests")


def _connect_starrocks():
    import mysql.connector

    return mysql.connector.connect(
        host=os.environ["STARROCKS_HOST"],
        port=int(os.environ.get("STARROCKS_PORT", "9030")),
        user=os.environ["STARROCKS_USER"],
        password=os.environ.get("STARROCKS_PASSWORD", ""),
        autocommit=True,
    )


@pytest.fixture(scope="module")
def temp_databases():
    """Create temporary StarRocks databases and test tables."""
    database = f"nao_sr_{uuid.uuid4().hex[:8]}"
    another_database = f"{database}_alt"
    conn = _connect_starrocks()
    cursor = conn.cursor()

    try:
        cursor.execute(f"CREATE DATABASE {database}")
        cursor.execute(f"CREATE DATABASE {another_database}")

        sql_file = Path(__file__).parent / "dml" / "starrocks.sql"
        sql_content = sql_file.read_text()

        cursor.execute(f"USE {DEFAULT_CATALOG}.{database}")
        for statement in sql_content.split(";"):
            statement = statement.strip()
            if statement:
                cursor.execute(statement)

        cursor.execute(f"USE {DEFAULT_CATALOG}.{another_database}")
        cursor.execute("CREATE TABLE whatever (id INT NOT NULL, price DOUBLE NOT NULL)")

        yield {"primary": database, "another": another_database}
    finally:
        cleanup_conn = _connect_starrocks()
        cleanup_cursor = cleanup_conn.cursor()
        try:
            cleanup_cursor.execute(f"DROP DATABASE IF EXISTS {database} FORCE")
            cleanup_cursor.execute(f"DROP DATABASE IF EXISTS {another_database} FORCE")
        except Exception:
            pass
        cleanup_cursor.close()
        cleanup_conn.close()
        cursor.close()
        conn.close()


@pytest.fixture
def db_config(temp_databases):
    return StarRocksConfig(
        name="test-starrocks",
        host=os.environ["STARROCKS_HOST"],
        port=int(os.environ.get("STARROCKS_PORT", "9030")),
        user=os.environ["STARROCKS_USER"],
        password=os.environ.get("STARROCKS_PASSWORD", ""),
        catalog=DEFAULT_CATALOG,
        schema_name=temp_databases["primary"],
    )


def test_sync_with_explicit_schema(tmp_path, db_config, temp_databases):
    output = tmp_path / "sync"
    with Progress(transient=True) as progress:
        state = sync_database(db_config, output, progress)

    primary_schema = f"{DEFAULT_CATALOG}.{temp_databases['primary']}"
    another_schema = f"{DEFAULT_CATALOG}.{temp_databases['another']}"
    base = output / "type=starrocks" / f"database={db_config.get_database_name()}"

    assert state.schemas_synced == 1
    assert state.tables_synced == 2
    assert primary_schema in state.synced_schemas
    assert (base / f"schema={primary_schema}" / "table=users" / "columns.md").exists()
    assert (base / f"schema={primary_schema}" / "table=orders" / "preview.md").exists()
    assert not (base / f"schema={another_schema}").exists()


def test_get_schemas_supports_catalog_prefix(db_config, temp_databases):
    config = db_config.model_copy(update={"schema_name": None})
    conn = config.connect()
    try:
        schemas = config.get_schemas(conn)
    finally:
        conn.disconnect()

    assert f"{DEFAULT_CATALOG}.{temp_databases['primary']}" in schemas
    assert f"{DEFAULT_CATALOG}.{temp_databases['another']}" in schemas


def test_execute_sql_works_with_three_part_names(db_config, temp_databases):
    schema = f"{DEFAULT_CATALOG}.{temp_databases['primary']}"
    df = db_config.execute_sql(f"SELECT COUNT(*) AS cnt FROM {schema}.users")
    assert len(df) == 1
    assert int(df.iloc[0, 0]) == 3
