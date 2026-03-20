"""Integration tests for the database sync pipeline against a real MySQL database.

Connection is configured via environment variables:
    MYSQL_HOST, MYSQL_PORT (default 3306),
    MYSQL_USER, MYSQL_PASSWORD.

The test suite is skipped entirely when MYSQL_HOST is not set.

To run locally with Docker:
    docker run -e MYSQL_ROOT_PASSWORD=naoTesting123! -p 3306:3306 mysql:8

    MYSQL_HOST=localhost MYSQL_USER=root MYSQL_PASSWORD="naoTesting123!" \\
        uv run pytest tests/nao_core/commands/sync/integration/test_mysql.py -v
"""

import os
import uuid
from pathlib import Path

import ibis
import pytest

from nao_core.config.databases.mysql import MysqlConfig

from .base import BaseSyncIntegrationTests, SyncTestSpec

MYSQL_HOST = os.environ.get("MYSQL_HOST")

pytestmark = pytest.mark.skipif(MYSQL_HOST is None, reason="MYSQL_HOST not set — skipping MySQL integration tests")

_ANOTHER_SUFFIX = "_alt"


def _mysql_conn(database: str = "information_schema"):
    """Create an ibis MySQL connection for DDL operations."""
    return ibis.mysql.connect(
        host=os.environ["MYSQL_HOST"],
        port=int(os.environ.get("MYSQL_PORT", "3306")),
        database=database,
        user=os.environ["MYSQL_USER"],
        password=os.environ.get("MYSQL_PASSWORD", ""),
    )


@pytest.fixture(scope="module")
def temp_database():
    """Create temporary databases and populate with test data, then clean up."""
    db_name = f"nao_test_{uuid.uuid4().hex[:8].lower()}"
    another_db = f"{db_name}{_ANOTHER_SUFFIX}"

    conn = _mysql_conn()

    try:
        conn.raw_sql(f"CREATE DATABASE `{db_name}`")
        conn.raw_sql(f"CREATE DATABASE `{another_db}`")
        conn.disconnect()

        # Populate main database
        conn = _mysql_conn(db_name)
        sql_file = Path(__file__).parent / "dml" / "mysql.sql"
        sql_content = sql_file.read_text()

        for statement in sql_content.split(";"):
            statement = statement.strip()
            if statement:
                try:
                    conn.raw_sql(statement).fetchall()
                except Exception:
                    pass

        conn.disconnect()

        # Populate "another" database with a single table
        conn = _mysql_conn(another_db)
        conn.raw_sql("CREATE TABLE whatever (id INT NOT NULL, price DOUBLE NOT NULL)")
        conn.disconnect()

        yield db_name

    finally:
        conn = _mysql_conn()
        try:
            conn.raw_sql(f"DROP DATABASE IF EXISTS `{db_name}`")
            conn.raw_sql(f"DROP DATABASE IF EXISTS `{another_db}`")
        except Exception:
            pass
        conn.disconnect()


@pytest.fixture(scope="module")
def db_config(temp_database):
    """Build a MysqlConfig from environment variables using the temporary database."""
    return MysqlConfig(
        name="test-mysql",
        host=os.environ["MYSQL_HOST"],
        port=int(os.environ.get("MYSQL_PORT", "3306")),
        database=temp_database,
        user=os.environ["MYSQL_USER"],
        password=os.environ.get("MYSQL_PASSWORD", ""),
        schema_name=temp_database,
    )


@pytest.fixture(scope="module")
def spec(temp_database):
    another_db = f"{temp_database}{_ANOTHER_SUFFIX}"
    return SyncTestSpec(
        db_type="mysql",
        primary_schema=temp_database,
        users_column_assertions=(
            "# users",
            f"**Dataset:** `{temp_database}`",
            "## Columns (4)",
            "- id",
            "- name",
            '"User email address"',
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
        users_table_description="Registered user accounts",
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
                "type": "int8",
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
        another_schema=another_db,
        another_table="whatever",
    )


class TestMysqlSyncIntegration(BaseSyncIntegrationTests):
    """Verify the sync pipeline produces correct output against a live MySQL database."""
