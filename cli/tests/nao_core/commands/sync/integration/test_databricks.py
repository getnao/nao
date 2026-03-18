"""Integration tests for the database sync pipeline against a real Databricks workspace.

Connection is configured via environment variables:
        DATABRICKS_SERVER_HOSTNAME, DATABRICKS_HTTP_PATH, DATABRICKS_ACCESS_TOKEN,
        DATABRICKS_CATALOG, DATABRICKS_SCHEMA (default public).

The test suite is skipped entirely when DATABRICKS_SERVER_HOSTNAME is not set.
"""

import os
import uuid
from pathlib import Path

import ibis
import pytest

from nao_core.config.databases.databricks import DatabricksConfig

from .base import BaseSyncIntegrationTests, SyncTestSpec

DATABRICKS_SERVER_HOSTNAME = os.environ.get("DATABRICKS_SERVER_HOSTNAME")

pytestmark = pytest.mark.skipif(
    DATABRICKS_SERVER_HOSTNAME is None,
    reason="DATABRICKS_SERVER_HOSTNAME not set — skipping Databricks integration tests",
)


@pytest.fixture(scope="module")
def temp_catalog():
    """Create a temporary catalog and populate it with test data, then clean up."""
    catalog_name = f"nao_unit_tests_{uuid.uuid4().hex[:8]}"

    # Connect to Databricks using ibis
    conn = ibis.databricks.connect(
        server_hostname=os.environ["DATABRICKS_SERVER_HOSTNAME"],
        http_path=os.environ["DATABRICKS_HTTP_PATH"],
        access_token=os.environ["DATABRICKS_ACCESS_TOKEN"],
    )

    try:
        # Create temporary catalog
        conn.raw_sql(f"CREATE CATALOG {catalog_name}").fetchall()
        conn.raw_sql(f"USE CATALOG {catalog_name}").fetchall()
        conn.raw_sql("CREATE SCHEMA public").fetchall()
        conn.raw_sql("USE SCHEMA public").fetchall()

        # Read and execute SQL script
        sql_file = Path(__file__).parent / "dml" / "databricks.sql"
        sql_template = sql_file.read_text()

        # Inject catalog name into SQL
        sql_content = sql_template.format(catalog=catalog_name)

        # Execute SQL statements
        for statement in sql_content.split(";"):
            statement = statement.strip()
            if statement:
                conn.raw_sql(statement).fetchall()

        yield catalog_name

    finally:
        # Clean up: drop the temporary catalog
        conn.raw_sql(f"DROP CATALOG IF EXISTS {catalog_name} CASCADE").fetchall()
        conn.disconnect()


@pytest.fixture(scope="module")
def db_config(temp_catalog):
    """Build a DatabricksConfig from environment variables using the temporary catalog."""
    return DatabricksConfig(
        name="test-databricks",
        server_hostname=os.environ["DATABRICKS_SERVER_HOSTNAME"],
        http_path=os.environ["DATABRICKS_HTTP_PATH"],
        access_token=os.environ["DATABRICKS_ACCESS_TOKEN"],
        catalog=temp_catalog,
        schema_name=os.environ.get("DATABRICKS_SCHEMA", "public"),
    )


@pytest.fixture(scope="module")
def spec():
    return SyncTestSpec(
        db_type="databricks",
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


class TestDatabricksSyncIntegration(BaseSyncIntegrationTests):
    """Verify the sync pipeline produces correct output against a live Databricks workspace."""
