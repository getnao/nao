"""Integration tests for the database sync pipeline using a real DuckDB database."""

import duckdb
import pytest

from nao_core.config.databases.duckdb import DuckDBConfig

from .base import BaseSyncIntegrationTests, SyncTestSpec


@pytest.fixture(scope="module")
def duckdb_path(tmp_path_factory):
    """Create a DuckDB database with two tables: users and orders."""
    db_path = tmp_path_factory.mktemp("duckdb_data") / "test.duckdb"
    conn = duckdb.connect(str(db_path))

    conn.execute("""
        CREATE TABLE users (
            id INTEGER NOT NULL,
            name VARCHAR NOT NULL,
            email VARCHAR,
            active BOOLEAN DEFAULT TRUE
        )
    """)
    conn.execute("""
        INSERT INTO users VALUES
            (1, 'Alice', 'alice@example.com', true),
            (2, 'Bob', NULL, false),
            (3, 'Charlie', 'charlie@example.com', true)
    """)

    conn.execute("""
        CREATE TABLE orders (
            id INTEGER NOT NULL,
            user_id INTEGER NOT NULL,
            amount DOUBLE NOT NULL
        )
    """)
    conn.execute("""
        INSERT INTO orders VALUES
            (1, 1, 99.99),
            (2, 1, 24.50)
    """)

    conn.close()
    return db_path


@pytest.fixture(scope="module")
def db_config(duckdb_path):
    """Build a DuckDBConfig pointing at the temporary database."""
    return DuckDBConfig(name="test-db", path=str(duckdb_path))


@pytest.fixture(scope="module")
def spec():
    return SyncTestSpec(
        db_type="duckdb",
        primary_schema="main",
        users_column_assertions=(
            "# users",
            "**Dataset:** `main`",
            "## Columns (4)",
            "- id (int32 NOT NULL)",
            "- name (string NOT NULL)",
            "- email (string)",
            "- active (boolean)",
        ),
        orders_column_assertions=(
            "# orders",
            "**Dataset:** `main`",
            "## Columns (3)",
            "- id (int32 NOT NULL)",
            "- user_id (int32 NOT NULL)",
            "- amount (float64 NOT NULL)",
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
    )


class TestDuckDBSyncIntegration(BaseSyncIntegrationTests):
    """Verify the sync pipeline produces correct output against a local DuckDB database."""
