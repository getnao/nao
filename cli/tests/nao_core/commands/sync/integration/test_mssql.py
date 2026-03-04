"""Integration tests for the database sync pipeline against a real MSSQL database.

Connection is configured via environment variables:
    MSSQL_HOST, MSSQL_PORT (default 1433), MSSQL_USER (default sa),
    MSSQL_PASSWORD, MSSQL_DRIVER (default FreeTDS),
    MSSQL_SCHEMA (default dbo).

The test suite is skipped entirely when MSSQL_HOST is not set.

To run locally with Docker:
    docker run -e "ACCEPT_EULA=Y" -e "SA_PASSWORD=naoTesting123!" \\
        -p 1433:1433 mcr.microsoft.com/mssql/server:2022-latest

    MSSQL_HOST=localhost MSSQL_PASSWORD="naoTesting123!" \\
        MSSQL_DRIVER="/opt/homebrew/opt/freetds/lib/libtdsodbc.so" \\
        uv run pytest tests/nao_core/commands/sync/integration/test_mssql.py -v
"""

import os
import uuid
from pathlib import Path

import pyodbc
import pytest

from nao_core.config.databases.mssql import MssqlConfig

from .base import BaseSyncIntegrationTests, SyncTestSpec

MSSQL_HOST = os.environ.get("MSSQL_HOST")

pytestmark = pytest.mark.skipif(MSSQL_HOST is None, reason="MSSQL_HOST not set — skipping MSSQL integration tests")


def _pyodbc_conn(database: str = "master") -> pyodbc.Connection:
    """Create a raw pyodbc connection with autocommit for DDL operations."""
    host = os.environ["MSSQL_HOST"]
    port = int(os.environ.get("MSSQL_PORT", "1433"))
    user = os.environ.get("MSSQL_USER", "sa")
    password = os.environ["MSSQL_PASSWORD"]
    driver = os.environ.get("MSSQL_DRIVER", "FreeTDS")

    conn = pyodbc.connect(
        driver=driver,
        server=f"{host},{port}",
        database=database,
        user=user,
        password=password,
        autocommit=True,
    )
    return conn


@pytest.fixture(scope="module")
def temp_database():
    """Create a temporary database and populate it with test data, then clean up."""
    db_name = f"nao_unit_tests_{uuid.uuid4().hex[:8].lower()}"

    # Use raw pyodbc with autocommit for DDL (MSSQL forbids CREATE/ALTER DATABASE in transactions)
    master_conn = _pyodbc_conn("master")

    try:
        master_conn.execute(f"CREATE DATABASE [{db_name}]")
        master_conn.close()

        # Populate the test database
        db_conn = _pyodbc_conn(db_name)
        sql_file = Path(__file__).parent / "dml" / "mssql.sql"
        sql_content = sql_file.read_text()

        for statement in sql_content.split(";"):
            statement = statement.strip()
            if statement:
                try:
                    db_conn.execute(statement)
                except Exception:
                    pass

        db_conn.close()

        yield db_name

    finally:
        # Reconnect to master and force-drop the test database
        master_conn = _pyodbc_conn("master")
        try:
            master_conn.execute(f"ALTER DATABASE [{db_name}] SET SINGLE_USER WITH ROLLBACK IMMEDIATE")
            master_conn.execute(f"DROP DATABASE [{db_name}]")
        except Exception:
            pass
        master_conn.close()


@pytest.fixture(scope="module")
def db_config(temp_database):
    """Build a MssqlConfig from environment variables using the temporary database."""
    return MssqlConfig(
        name="test-mssql",
        host=os.environ["MSSQL_HOST"],
        port=int(os.environ.get("MSSQL_PORT", "1433")),
        database=temp_database,
        user=os.environ.get("MSSQL_USER", "sa") or "sa",
        password=os.environ["MSSQL_PASSWORD"],
        driver=os.environ.get("MSSQL_DRIVER", "FreeTDS"),
        schema_name=os.environ.get("MSSQL_SCHEMA", "dbo"),
    )


@pytest.fixture(scope="module")
def spec():
    return SyncTestSpec(
        db_type="mssql",
        primary_schema="dbo",
        users_column_assertions=(
            "# users",
            "**Dataset:** `dbo`",
            "## Columns (4)",
            "- id",
            "- name",
            "- email",
            "- active",
        ),
        orders_column_assertions=(
            "# orders",
            "**Dataset:** `dbo`",
            "## Columns (3)",
            "- id",
            "- user_id",
            "- amount",
        ),
        users_preview_rows=[
            {"id": 1, "name": "Alice", "email": "alice@example.com", "active": True},
            {"id": 2, "name": "Bob", "email": None, "active": False},
            {"id": 3, "name": "Charlie", "email": "charlie@example.com", "active": True},
        ],
        orders_preview_rows=[
            {"id": 1, "user_id": 1, "amount": 99.99},
            {"id": 2, "user_id": 1, "amount": 24.5},
        ],
        users_profiling_rows=[
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
        ],
        orders_profiling_rows=[
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
        ],
        schema_field="schema_name",
        another_schema="another",
        another_table="whatever",
    )


class TestMssqlSyncIntegration(BaseSyncIntegrationTests):
    """Verify the sync pipeline produces correct output against a live MSSQL database."""
