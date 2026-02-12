"""Integration tests for the database sync pipeline against a real Postgres database.

Connection is configured via environment variables:
    POSTGRES_HOST, POSTGRES_PORT (default 5432), POSTGRES_DATABASE,
    POSTGRES_USER, POSTGRES_PASSWORD,
    POSTGRES_SCHEMA (default public).

The test suite is skipped entirely when POSTGRES_HOST is not set.
"""

import os
import uuid
from pathlib import Path

import ibis
import pytest

from nao_core.config.databases.postgres import PostgresConfig

from .base import BaseSyncIntegrationTests, SyncTestSpec

POSTGRES_HOST = os.environ.get("POSTGRES_HOST")

pytestmark = pytest.mark.skipif(
    POSTGRES_HOST is None, reason="POSTGRES_HOST not set — skipping Postgres integration tests"
)


@pytest.fixture(scope="module")
def temp_database():
    """Create a temporary database and populate it with test data, then clean up."""
    db_name = f"nao_unit_tests_{uuid.uuid4().hex[:8].lower()}"

    # Connect to default postgres database to create test database
    conn = ibis.postgres.connect(
        host=os.environ["POSTGRES_HOST"],
        port=int(os.environ.get("POSTGRES_PORT", "5432")),
        database="postgres",
        user=os.environ["POSTGRES_USER"],
        password=os.environ["POSTGRES_PASSWORD"],
    )

    try:
        # Create temporary database
        conn.raw_sql(f"CREATE DATABASE {db_name}")
        conn.disconnect()

        # Connect to the new database
        conn = ibis.postgres.connect(
            host=os.environ["POSTGRES_HOST"],
            port=int(os.environ.get("POSTGRES_PORT", "5432")),
            database=db_name,
            user=os.environ["POSTGRES_USER"],
            password=os.environ["POSTGRES_PASSWORD"],
        )

        # Read and execute SQL script
        sql_file = Path(__file__).parent / "dml" / "postgres.sql"
        sql_content = sql_file.read_text()

        # Execute SQL statements
        for statement in sql_content.split(";"):
            statement = statement.strip()
            if statement:
                try:
                    conn.raw_sql(statement).fetchall()
                except Exception:
                    # Some statements (like CREATE SCHEMA) don't return results
                    pass

        yield db_name

    finally:
        # Clean up: disconnect and drop the temporary database
        conn.disconnect()

        # Reconnect to postgres database to drop test database
        conn = ibis.postgres.connect(
            host=os.environ["POSTGRES_HOST"],
            port=int(os.environ.get("POSTGRES_PORT", "5432")),
            database="postgres",
            user=os.environ["POSTGRES_USER"],
            password=os.environ["POSTGRES_PASSWORD"],
        )

        # Terminate any active connections to the test database
        conn.raw_sql(f"""
            SELECT pg_terminate_backend(pg_stat_activity.pid)
            FROM pg_stat_activity
            WHERE pg_stat_activity.datname = '{db_name}'
              AND pid <> pg_backend_pid()
        """)

        # Drop the database
        conn.raw_sql(f"DROP DATABASE IF EXISTS {db_name}")
        conn.disconnect()


@pytest.fixture(scope="module")
def db_config(temp_database):
    """Build a PostgresConfig from environment variables using the temporary database."""
    return PostgresConfig(
        name="test-postgres",
        host=os.environ["POSTGRES_HOST"],
        port=int(os.environ.get("POSTGRES_PORT", "5432")),
        database=temp_database,
        user=os.environ["POSTGRES_USER"],
        password=os.environ["POSTGRES_PASSWORD"],
        schema_name=os.environ.get("POSTGRES_SCHEMA", "public"),
    )


@pytest.fixture(scope="module")
def spec():
    return SyncTestSpec(
        db_type="postgres",
        primary_schema="public",
        users_column_assertions=(
            "# users",
            "**Dataset:** `public`",
            "## Columns (4)",
            "- id",
            "- name",
            '"User email address"',
            "- active",
        ),
        orders_column_assertions=(
            "# orders",
            "**Dataset:** `public`",
            "## Columns (3)",
            "- id",
            "- user_id",
            "- amount",
        ),
        users_table_description="Registered user accounts",
        users_preview_rows=[
            {"id": 1, "name": "Alice", "email": "alice@example.com", "active": True},
            {"id": 2, "name": "Bob", "email": None, "active": False},
            {"id": 3, "name": "Charlie", "email": "charlie@example.com", "active": True},
        ],
        orders_preview_rows=[
            {"id": 1, "user_id": 1, "amount": 99.99},
            {"id": 2, "user_id": 1, "amount": 24.5},
        ],
        schema_field="schema_name",
        another_schema="another",
        another_table="whatever",
    )


class TestPostgresSyncIntegration(BaseSyncIntegrationTests):
    """Verify the sync pipeline produces correct output against a live Postgres database."""
