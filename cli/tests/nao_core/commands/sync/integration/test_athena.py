"""Integration tests for the database sync pipeline against a real Athena database.

Connection is configured via environment variables:
    ATHENA_S3_STAGING_DIR, ATHENA_REGION, ATHENA_ACCESS_KEY_ID, ATHENA_SECRET_ACCESS_KEY, ATHENA_PROFILE.
    Optionally ATHENA_SESSION_TOKEN.

The test suite is skipped entirely when ATHENA_S3_STAGING_DIR is not set.
"""

import os
import uuid
from pathlib import Path

import ibis
import pytest

from nao_core.config.databases.athena import AthenaConfig

from .base import BaseSyncIntegrationTests, SyncTestSpec

ATHENA_S3_STAGING_DIR = os.environ.get("ATHENA_S3_STAGING_DIR")
ATHENA_REGION = os.environ.get("ATHENA_REGION", "us-east-1")
ATHENA_PROFILE = os.environ.get("ATHENA_PROFILE")
ATHENA_WORKGROUP = os.environ.get("ATHENA_WORKGROUP")

pytestmark = pytest.mark.skipif(
    ATHENA_S3_STAGING_DIR is None, reason="ATHENA_S3_STAGING_DIR not set — skipping Athena integration tests"
)


@pytest.fixture(scope="module")
def temp_databases():
    """Create temporary databases and populate them with test data, then clean up."""
    # Ensure S3 staging dir is available (fixture scope ensures env var is checked already via skipif)
    db_name = f"nao_integration_tests_{uuid.uuid4().hex[:8]}"
    another_db_name = f"nao_integration_tests_another_{uuid.uuid4().hex[:8]}"
    kwargs = {
        "s3_staging_dir": ATHENA_S3_STAGING_DIR,
        "region_name": ATHENA_REGION,
    }
    if ATHENA_WORKGROUP:
        kwargs["work_group"] = ATHENA_WORKGROUP

    if ATHENA_PROFILE:
        kwargs["profile_name"] = ATHENA_PROFILE
    elif os.environ.get("ATHENA_ACCESS_KEY_ID") and os.environ.get("ATHENA_SECRET_ACCESS_KEY"):
        kwargs["aws_access_key_id"] = os.environ.get("ATHENA_ACCESS_KEY_ID")
        kwargs["aws_secret_access_key"] = os.environ.get("ATHENA_SECRET_ACCESS_KEY")
        if os.environ.get("ATHENA_SESSION_TOKEN"):
            kwargs["aws_session_token"] = os.environ.get("ATHENA_SESSION_TOKEN")

    conn = ibis.athena.connect(**kwargs)

    try:
        # Create temporary databases
        conn.raw_sql(f"CREATE DATABASE IF NOT EXISTS {db_name}").fetchall()
        conn.raw_sql(f"CREATE DATABASE IF NOT EXISTS {another_db_name}").fetchall()

        # Read and execute SQL script
        sql_file = Path(__file__).parent / "dml" / "athena.sql"
        sql_template = sql_file.read_text()

        # Inject database names into SQL
        sql_content = sql_template.format(
            database=db_name,
            another_database=another_db_name,
            s3_staging_dir=kwargs["s3_staging_dir"],
        )

        # Execute SQL statements
        for statement in sql_content.split(";"):
            statement = statement.strip()
            if not statement:
                continue
            conn.raw_sql(statement).fetchall()

        yield {"main": db_name, "another": another_db_name}

    finally:
        try:
            conn.raw_sql(f"DROP DATABASE IF EXISTS {db_name} CASCADE").fetchall()
        except Exception:
            pass
        try:
            conn.raw_sql(f"DROP DATABASE IF EXISTS {another_db_name} CASCADE").fetchall()
        except Exception:
            pass
        conn.disconnect()


@pytest.fixture(scope="module")
def db_config(temp_databases):
    """Build an AthenaConfig from environment variables using the temporary database."""
    return AthenaConfig(
        name="test-athena",
        s3_staging_dir=ATHENA_S3_STAGING_DIR or "",
        region_name=ATHENA_REGION,
        schema_name=temp_databases["main"],
        work_group=ATHENA_WORKGROUP or "primary",
        profile_name=ATHENA_PROFILE,
        aws_access_key_id=os.environ.get("ATHENA_ACCESS_KEY_ID"),
        aws_secret_access_key=os.environ.get("ATHENA_SECRET_ACCESS_KEY"),
        aws_session_token=os.environ.get("ATHENA_SESSION_TOKEN"),
    )


@pytest.fixture(scope="module")
def spec(temp_databases):
    return SyncTestSpec(
        db_type="athena",
        primary_schema=temp_databases["main"],
        users_column_assertions=(
            "# users",
            f"**Dataset:** `{temp_databases['main']}`",
            "## Columns (4)",
            "- id (int32)",
            "- name (string)",
            "- email (string)",
            "- active (boolean)",
        ),
        orders_column_assertions=(
            "# orders",
            f"**Dataset:** `{temp_databases['main']}`",
            "## Columns (3)",
            "- id (int32)",
            "- user_id (int32)",
            "- amount (float64)",
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
        sort_rows=True,
        row_id_key="id",
        schema_field="schema_name",
        another_schema=temp_databases["another"],
        another_table="whatever",
        filter_schema=temp_databases["main"],
    )


class TestAthenaSyncIntegration(BaseSyncIntegrationTests):
    """Verify the sync pipeline produces correct output against a real Athena database."""
