"""Integration tests for the database sync pipeline against a real Databricks workspace.

Connection is configured via environment variables:
        DATABRICKS_SERVER_HOSTNAME, DATABRICKS_HTTP_PATH, DATABRICKS_ACCESS_TOKEN,
        DATABRICKS_CATALOG, DATABRICKS_SCHEMA (default public).

The test suite is skipped entirely when DATABRICKS_SERVER_HOSTNAME is not set.
"""

import os
import uuid

import ibis
import pytest

from nao_core.config.databases.databricks import DatabricksConfig

from .base import BaseSyncIntegrationTests, SyncTestSpec, dml_statements

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

        for statement in dml_statements("databricks.sql", catalog=catalog_name):
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
        schema_field="schema_name",
        another_schema="another",
        another_table="whatever",
    )


class TestDatabricksSyncIntegration(BaseSyncIntegrationTests):
    """Verify the sync pipeline produces correct output against a live Databricks workspace."""
