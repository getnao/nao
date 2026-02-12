"""Integration tests for the database sync pipeline against a real Snowflake database.

Connection is configured via environment variables:
    SNOWFLAKE_ACCOUNT_ID, SNOWFLAKE_USERNAME
    SNOWFLAKE_PRIVATE_KEY_PATH, SNOWFLAKE_PASSPHRASE (optional),
    SNOWFLAKE_SCHEMA (default public), SNOWFLAKE_WAREHOUSE (optional).

The test suite is skipped entirely when SNOWFLAKE_ACCOUNT_ID is not set.
"""

import os
import uuid
from pathlib import Path

import ibis
import pytest
from cryptography.hazmat.backends import default_backend
from cryptography.hazmat.primitives import serialization

from nao_core.config.databases.snowflake import SnowflakeConfig

from .base import BaseSyncIntegrationTests, SyncTestSpec

SNOWFLAKE_ACCOUNT_ID = os.environ.get("SNOWFLAKE_ACCOUNT_ID")

pytestmark = pytest.mark.skipif(
    SNOWFLAKE_ACCOUNT_ID is None, reason="SNOWFLAKE_ACCOUNT_ID not set — skipping Snowflake integration tests"
)


@pytest.fixture(scope="module")
def temp_database():
    """Create a temporary database and populate it with test data, then clean up."""
    db_name = f"NAO_UNIT_TESTS_{uuid.uuid4().hex[:8].upper()}"

    # Load private key for authentication
    private_key_path = os.environ["SNOWFLAKE_PRIVATE_KEY_PATH"]
    passphrase = os.environ.get("SNOWFLAKE_PASSPHRASE")

    with open(private_key_path, "rb") as key_file:
        private_key = serialization.load_pem_private_key(
            key_file.read(),
            password=passphrase.encode() if passphrase else None,
            backend=default_backend(),
        )
        private_key_bytes = private_key.private_bytes(
            encoding=serialization.Encoding.DER,
            format=serialization.PrivateFormat.PKCS8,
            encryption_algorithm=serialization.NoEncryption(),
        )

    # Connect to Snowflake (without specifying database) to create temp database
    conn = ibis.snowflake.connect(
        user=os.environ["SNOWFLAKE_USERNAME"],
        account=os.environ["SNOWFLAKE_ACCOUNT_ID"],
        private_key=private_key_bytes,
        warehouse=os.environ.get("SNOWFLAKE_WAREHOUSE"),
        create_object_udfs=False,
    )

    try:
        # Create temporary database
        conn.raw_sql(f"CREATE DATABASE {db_name}").fetchall()

        # Connect to the new database and run setup script
        test_conn = ibis.snowflake.connect(
            user=os.environ["SNOWFLAKE_USERNAME"],
            account=os.environ["SNOWFLAKE_ACCOUNT_ID"],
            private_key=private_key_bytes,
            warehouse=os.environ.get("SNOWFLAKE_WAREHOUSE"),
            database=db_name,
            create_object_udfs=False,
        )

        # Create schema
        test_conn.raw_sql("CREATE SCHEMA IF NOT EXISTS public").fetchall()

        # Read and execute SQL script
        sql_file = Path(__file__).parent / "dml" / "snowflake.sql"
        sql_template = sql_file.read_text()

        # Inject database name into SQL
        sql_content = sql_template.format(database=db_name)

        # Execute SQL statements
        for statement in sql_content.split(";"):
            statement = statement.strip()
            if statement:
                test_conn.raw_sql(statement).fetchall()

        test_conn.disconnect()

        yield db_name

    finally:
        # Clean up: drop the temporary database
        conn.raw_sql(f"DROP DATABASE IF EXISTS {db_name}").fetchall()
        conn.disconnect()


@pytest.fixture(scope="module")
def db_config(temp_database):
    """Build a SnowflakeConfig from environment variables using the temporary database."""
    return SnowflakeConfig(
        name="test-snowflake",
        account_id=os.environ["SNOWFLAKE_ACCOUNT_ID"],
        username=os.environ["SNOWFLAKE_USERNAME"],
        database=temp_database,
        private_key_path=os.environ["SNOWFLAKE_PRIVATE_KEY_PATH"],
        passphrase=os.environ.get("SNOWFLAKE_PASSPHRASE"),
        schema_name="public",
        warehouse=os.environ.get("SNOWFLAKE_WAREHOUSE"),
    )


@pytest.fixture(scope="module")
def spec():
    return SyncTestSpec(
        db_type="snowflake",
        primary_schema="PUBLIC",
        users_table="USERS",
        orders_table="ORDERS",
        users_column_assertions=(
            "# USERS",
            "**Dataset:** `PUBLIC`",
            "## Columns (4)",
            "- ID",
            "- NAME",
            '"User email address"',
            "- ACTIVE",
        ),
        orders_column_assertions=(
            "# ORDERS",
            "**Dataset:** `PUBLIC`",
            "## Columns (3)",
            "- ID",
            "- USER_ID",
            "- AMOUNT",
        ),
        users_table_description="Registered user accounts",
        users_preview_rows=[
            {"ID": 1, "NAME": "Alice", "EMAIL": "alice@example.com", "ACTIVE": True},
            {"ID": 2, "NAME": "Bob", "EMAIL": None, "ACTIVE": False},
            {"ID": 3, "NAME": "Charlie", "EMAIL": "charlie@example.com", "ACTIVE": True},
        ],
        orders_preview_rows=[
            {"ID": 1.0, "USER_ID": 1.0, "AMOUNT": 99.99},
            {"ID": 2.0, "USER_ID": 1.0, "AMOUNT": 24.5},
        ],
        sort_rows=True,
        row_id_key="ID",
        filter_schema="public",
        schema_field="schema_name",
        another_schema="ANOTHER",
        another_table="WHATEVER",
    )


class TestSnowflakeSyncIntegration(BaseSyncIntegrationTests):
    """Verify the sync pipeline produces correct output against a live Snowflake database."""
