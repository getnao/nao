"""Integration tests for the database sync pipeline against a real Trino cluster.

Connection is configured via environment variables:
    TRINO_HOST, TRINO_PORT (default 8080), TRINO_CATALOG,
    TRINO_USER, TRINO_PASSWORD (optional).

The test suite is skipped entirely when TRINO_HOST is not set.
"""

import os
import uuid
from pathlib import Path

import ibis
import pytest

from nao_core.config.databases.trino import TrinoConfig

from .base import BaseSyncIntegrationTests, SyncTestSpec

TRINO_HOST = os.environ.get("TRINO_HOST")

pytestmark = pytest.mark.skipif(TRINO_HOST is None, reason="TRINO_HOST not set - skipping Trino integration tests")


@pytest.fixture(scope="module")
def temp_schemas():
    """Create temporary schemas/tables and clean up after tests."""
    public_schema = f"nao_it_public_{uuid.uuid4().hex[:8]}"
    another_schema = f"nao_it_another_{uuid.uuid4().hex[:8]}"

    kwargs = {
        "host": os.environ["TRINO_HOST"],
        "port": int(os.environ.get("TRINO_PORT", "8080")),
        "database": os.environ["TRINO_CATALOG"],
        "user": os.environ["TRINO_USER"],
    }
    if os.environ.get("TRINO_PASSWORD"):
        kwargs["password"] = os.environ["TRINO_PASSWORD"]

    conn = ibis.trino.connect(**kwargs)

    try:
        sql_file = Path(__file__).parent / "dml" / "trino.sql"
        sql_template = sql_file.read_text()
        sql_content = sql_template.format(public_schema=public_schema, another_schema=another_schema)

        for statement in sql_content.split(";"):
            statement = statement.strip()
            if statement:
                conn.raw_sql(statement)

        yield {"public": public_schema, "another": another_schema}

    finally:
        try:
            conn.raw_sql(f"DROP SCHEMA IF EXISTS {public_schema} CASCADE")
        except Exception:
            pass
        try:
            conn.raw_sql(f"DROP SCHEMA IF EXISTS {another_schema} CASCADE")
        except Exception:
            pass
        conn.disconnect()


@pytest.fixture(scope="module")
def db_config(temp_schemas):
    return TrinoConfig(
        name="test-trino",
        host=os.environ["TRINO_HOST"],
        port=int(os.environ.get("TRINO_PORT", "8080")),
        catalog=os.environ["TRINO_CATALOG"],
        user=os.environ["TRINO_USER"],
        password=os.environ.get("TRINO_PASSWORD"),
        schema_name=temp_schemas["public"],
    )


@pytest.fixture(scope="module")
def spec(temp_schemas):
    return SyncTestSpec(
        db_type="trino",
        primary_schema=temp_schemas["public"],
        users_column_assertions=(
            "# users",
            f"**Dataset:** `{temp_schemas['public']}`",
            "## Columns (4)",
            "- id",
            "- name",
            "- email",
            "- active",
        ),
        orders_column_assertions=(
            "# orders",
            f"**Dataset:** `{temp_schemas['public']}`",
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
        sort_rows=True,
        schema_field="schema_name",
        another_schema=temp_schemas["another"],
        another_table="whatever",
    )


class TestTrinoSyncIntegration(BaseSyncIntegrationTests):
    """Verify the sync pipeline produces correct output against a live Trino cluster."""

    def test_get_schemas_excludes_builtins(self, db_config, spec):
        """Trino built-in schemas must not be treated as user schemas."""
        config = db_config.model_copy(update={spec.schema_field: None})
        conn = config.connect()
        schemas = config.get_schemas(conn)

        normalized = {s.lower() for s in schemas}
        assert "information_schema" not in normalized
        assert "default" not in normalized
        assert "sys" not in normalized
