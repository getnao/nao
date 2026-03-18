"""Integration tests for the database sync pipeline against a real Snowflake database.

Connection is configured via environment variables:
    SNOWFLAKE_ACCOUNT_ID, SNOWFLAKE_USERNAME
    For password auth:
        SNOWFLAKE_PASSWORD
    For key-pair auth:
        SNOWFLAKE_PRIVATE_KEY_PATH, SNOWFLAKE_PASSPHRASE (optional),
    SNOWFLAKE_SCHEMA (default public), SNOWFLAKE_WAREHOUSE (optional).

The test suite is skipped entirely when required env vars are not set.
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
SNOWFLAKE_USERNAME = os.environ.get("SNOWFLAKE_USERNAME")
SNOWFLAKE_PASSWORD = os.environ.get("SNOWFLAKE_PASSWORD")
SNOWFLAKE_PRIVATE_KEY_PATH = os.environ.get("SNOWFLAKE_PRIVATE_KEY_PATH")
SNOWFLAKE_PASSPHRASE = os.environ.get("SNOWFLAKE_PASSPHRASE")
SNOWFLAKE_WAREHOUSE = os.environ.get("SNOWFLAKE_WAREHOUSE")

# Default auth method:
# - Prefer password if available (easier to set up locally)
# - Otherwise fall back to key-pair
SNOWFLAKE_AUTH_METHOD = (
    os.environ.get("SNOWFLAKE_AUTH_METHOD") or ("password" if SNOWFLAKE_PASSWORD else "keypair")
).lower()
if SNOWFLAKE_AUTH_METHOD not in {"password", "keypair"}:
    SNOWFLAKE_AUTH_METHOD = "password" if SNOWFLAKE_PASSWORD else "keypair"

_missing_base_env = [
    name
    for name, value in (
        ("SNOWFLAKE_ACCOUNT_ID", SNOWFLAKE_ACCOUNT_ID),
        ("SNOWFLAKE_USERNAME", SNOWFLAKE_USERNAME),
    )
    if not value
]

_missing_auth_env: list[str] = []
if SNOWFLAKE_AUTH_METHOD == "password":
    if not SNOWFLAKE_PASSWORD:
        _missing_auth_env.append("SNOWFLAKE_PASSWORD")
else:
    if not SNOWFLAKE_PRIVATE_KEY_PATH:
        _missing_auth_env.append("SNOWFLAKE_PRIVATE_KEY_PATH")

_private_key_file_missing = bool(SNOWFLAKE_PRIVATE_KEY_PATH) and not Path(SNOWFLAKE_PRIVATE_KEY_PATH).exists()

_skip_reason_parts: list[str] = []
if _missing_base_env or _missing_auth_env:
    _skip_reason_parts.append(f"missing env vars: {', '.join([*_missing_base_env, *_missing_auth_env])}")
if SNOWFLAKE_AUTH_METHOD == "keypair" and _private_key_file_missing:
    _skip_reason_parts.append(f"private key file not found at {SNOWFLAKE_PRIVATE_KEY_PATH!r}")

pytestmark = pytest.mark.skipif(
    bool(_skip_reason_parts),
    reason=f"Skipping Snowflake integration tests ({'; '.join(_skip_reason_parts)})",
)


def _private_key_bytes_from_env() -> bytes:
    if not SNOWFLAKE_PRIVATE_KEY_PATH:
        raise RuntimeError("SNOWFLAKE_PRIVATE_KEY_PATH is not set")
    with open(SNOWFLAKE_PRIVATE_KEY_PATH, "rb") as key_file:
        # If the key is encrypted with an empty passphrase, SNOWFLAKE_PASSPHRASE may be "".
        # cryptography expects b"" in that case (not None).
        password = None if SNOWFLAKE_PASSPHRASE is None else SNOWFLAKE_PASSPHRASE.encode()
        private_key = serialization.load_pem_private_key(
            key_file.read(),
            password=password,
            backend=default_backend(),
        )
        return private_key.private_bytes(
            encoding=serialization.Encoding.DER,
            format=serialization.PrivateFormat.PKCS8,
            encryption_algorithm=serialization.NoEncryption(),
        )


def _ibis_connect(*, database: str | None = None):
    kwargs: dict = {
        "user": SNOWFLAKE_USERNAME,
        "account": SNOWFLAKE_ACCOUNT_ID,
        "warehouse": SNOWFLAKE_WAREHOUSE,
        "create_object_udfs": False,
    }
    if database:
        kwargs["database"] = database

    if SNOWFLAKE_AUTH_METHOD == "password":
        kwargs["password"] = SNOWFLAKE_PASSWORD
    else:
        kwargs["private_key"] = _private_key_bytes_from_env()

    return ibis.snowflake.connect(**kwargs)


@pytest.fixture(scope="module")
def temp_database():
    """Create a temporary database and populate it with test data, then clean up."""
    db_name = f"NAO_UNIT_TESTS_{uuid.uuid4().hex[:8].upper()}"

    # Connect to Snowflake (without specifying database) to create temp database
    conn = _ibis_connect()

    try:
        # Create temporary database
        conn.raw_sql(f"CREATE DATABASE {db_name}").fetchall()

        # Connect to the new database and run setup script
        test_conn = _ibis_connect(database=db_name)

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
        password=os.environ.get("SNOWFLAKE_PASSWORD") if SNOWFLAKE_AUTH_METHOD == "password" else None,
        private_key_path=os.environ.get("SNOWFLAKE_PRIVATE_KEY_PATH") if SNOWFLAKE_AUTH_METHOD == "keypair" else None,
        passphrase=os.environ.get("SNOWFLAKE_PASSPHRASE") if SNOWFLAKE_AUTH_METHOD == "keypair" else None,
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
        users_profiling_rows=[
            {
                "column": "ID",
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
                "column": "NAME",
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
                "column": "EMAIL",
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
                "column": "ACTIVE",
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
                "column": "ID",
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
                "column": "USER_ID",
                "type": "int32",
                "total_count": 2,
                "null_count": 0,
                "null_percentage": 0.0,
                "distinct_count": 1,
                "top_values": [{"value": 1, "count": 2}],
            },
            {
                "column": "AMOUNT",
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
        sort_rows=True,
        row_id_key="ID",
        filter_schema="public",
        schema_field="schema_name",
        another_schema="ANOTHER",
        another_table="WHATEVER",
    )


class TestSnowflakeSyncIntegration(BaseSyncIntegrationTests):
    """Verify the sync pipeline produces correct output against a live Snowflake database."""
