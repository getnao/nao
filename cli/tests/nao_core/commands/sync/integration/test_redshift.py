"""Integration tests for the database sync pipeline against a real Redshift cluster.

Connection is configured via environment variables:
    REDSHIFT_HOST, REDSHIFT_PORT (default 5439), REDSHIFT_DATABASE,
    REDSHIFT_USER, REDSHIFT_PASSWORD, REDSHIFT_SCHEMA (default public),
    REDSHIFT_SSLMODE (default require).

The test suite is skipped entirely when REDSHIFT_HOST is not set.
"""

import os
import uuid
from pathlib import Path

import ibis
import pytest

from nao_core.config.databases.redshift import RedshiftConfig

from .base import BaseSyncIntegrationTests, SyncTestSpec

REDSHIFT_HOST = os.environ.get("REDSHIFT_HOST")

pytestmark = pytest.mark.skipif(
    REDSHIFT_HOST is None, reason="REDSHIFT_HOST not set — skipping Redshift integration tests"
)


@pytest.fixture(scope="module")
def temp_database():
    """Create a temporary database and populate it with test data, then clean up."""
    db_name = f"nao_unit_tests_{uuid.uuid4().hex[:8]}"

    # Connect to default database to create temp database
    conn = ibis.postgres.connect(
        host=os.environ["REDSHIFT_HOST"],
        port=int(os.environ.get("REDSHIFT_PORT", "5439")),
        database=os.environ.get("REDSHIFT_DATABASE", "dev"),
        user=os.environ["REDSHIFT_USER"],
        password=os.environ["REDSHIFT_PASSWORD"],
        client_encoding="utf8",
        sslmode=os.environ.get("REDSHIFT_SSLMODE", "require"),
    )

    try:
        # Create temporary database
        conn.raw_sql(f"CREATE DATABASE {db_name}")

        # Connect to the new database and run setup script
        test_conn = ibis.postgres.connect(
            host=os.environ["REDSHIFT_HOST"],
            port=int(os.environ.get("REDSHIFT_PORT", "5439")),
            database=db_name,
            user=os.environ["REDSHIFT_USER"],
            password=os.environ["REDSHIFT_PASSWORD"],
            client_encoding="utf8",
            sslmode=os.environ.get("REDSHIFT_SSLMODE", "require"),
        )

        # Read and execute SQL script
        sql_file = Path(__file__).parent / "dml" / "redshift.sql"
        sql_template = sql_file.read_text()

        # Inject database name into SQL
        sql_content = sql_template.format(database=db_name)

        # Execute SQL statements
        for statement in sql_content.split(";"):
            statement = statement.strip()
            if statement:
                test_conn.raw_sql(statement)

        test_conn.disconnect()

        yield db_name

    finally:
        # Clean up: drop the temporary database (Redshift doesn't support IF EXISTS)
        try:
            conn.raw_sql(f"DROP DATABASE {db_name}")
        except Exception:
            pass  # Database might not exist if setup failed
        conn.disconnect()


@pytest.fixture(scope="module")
def db_config(temp_database):
    """Build a RedshiftConfig from environment variables using the temporary database."""
    return RedshiftConfig(
        name="test-redshift",
        host=os.environ["REDSHIFT_HOST"],
        port=int(os.environ.get("REDSHIFT_PORT", "5439")),
        database=temp_database,
        user=os.environ["REDSHIFT_USER"],
        password=os.environ["REDSHIFT_PASSWORD"],
        schema_name=os.environ.get("REDSHIFT_SCHEMA", "public"),
        sslmode=os.environ.get("REDSHIFT_SSLMODE", "require"),
    )


@pytest.fixture(scope="module")
def spec():
    return SyncTestSpec(
        db_type="redshift",
        primary_schema="public",
        users_column_assertions=(
            "# users",
            "**Dataset:** `public`",
            "## Columns (4)",
            "- id (int32 NOT NULL)",
            "- name (string NOT NULL)",
            "- email (string)",
            "- active (boolean)",
        ),
        orders_column_assertions=(
            "# orders",
            "**Dataset:** `public`",
            "## Columns (3)",
            "- id (int32 NOT NULL)",
            "- user_id (int32 NOT NULL)",
            "- amount (float32 NOT NULL)",
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
        schema_field="schema_name",
        another_schema="another",
        another_table="whatever",
    )


class TestRedshiftSyncIntegration(BaseSyncIntegrationTests):
    """Verify the sync pipeline produces correct output against a live Redshift cluster."""
