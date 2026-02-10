"""Integration tests for the database sync pipeline against a real Databricks workspace.

Connection is configured via environment variables:
        DATABRICKS_SERVER_HOSTNAME, DATABRICKS_HTTP_PATH, DATABRICKS_ACCESS_TOKEN,
        DATABRICKS_CATALOG, DATABRICKS_SCHEMA (default public).

The test suite is skipped entirely when DATABRICKS_SERVER_HOSTNAME is not set.
"""

import json
import os
import uuid
from pathlib import Path

import ibis
import pytest
from rich.progress import Progress

from nao_core.commands.sync.providers.databases.provider import sync_database
from nao_core.config.databases.databricks import DatabricksConfig

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
def databricks_config(temp_catalog):
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
def synced(tmp_path_factory, databricks_config):
    """Run sync once for the whole module and return (state, output_path, config)."""
    output = tmp_path_factory.mktemp("databricks_sync")

    with Progress(transient=True) as progress:
        state = sync_database(databricks_config, output, progress)

    return state, output, databricks_config


class TestDatabricksSyncIntegration:
    """Verify the sync pipeline produces correct output against a live Databricks workspace."""

    def test_creates_expected_directory_tree(self, synced):
        state, output, config = synced

        base = output / "type=databricks" / f"database={config.catalog}" / "schema=public"

        # Schema directory
        assert base.is_dir()

        # Each table should have exactly the 3 default template outputs
        for table in ("orders", "users"):
            assert (base / f"table={table}").is_dir()
            table_dir = base / f"table={table}"
            files = sorted(f.name for f in table_dir.iterdir())
            assert files == ["columns.md", "description.md", "preview.md"]

        # Verify that the "another" schema was NOT synced
        another_schema_dir = output / "type=databricks" / f"database={config.catalog}" / "schema=another"
        assert not another_schema_dir.exists()

    def test_columns_md_users(self, synced):
        state, output, config = synced

        content = (
            output / "type=databricks" / f"database={config.catalog}" / "schema=public" / "table=users" / "columns.md"
        ).read_text()

        # Databricks column types
        assert "# users" in content
        assert "**Dataset:** `public`" in content
        assert "## Columns (4)" in content
        assert "- id" in content
        assert "- name" in content
        assert "- email" in content
        assert "- active" in content

    def test_columns_md_orders(self, synced):
        state, output, config = synced

        content = (
            output / "type=databricks" / f"database={config.catalog}" / "schema=public" / "table=orders" / "columns.md"
        ).read_text()

        assert "# orders" in content
        assert "**Dataset:** `public`" in content
        assert "## Columns (3)" in content
        assert "- id" in content
        assert "- user_id" in content
        assert "- amount" in content

    def test_description_md_users(self, synced):
        state, output, config = synced

        content = (
            output
            / "type=databricks"
            / f"database={config.catalog}"
            / "schema=public"
            / "table=users"
            / "description.md"
        ).read_text()

        assert "# users" in content
        assert "**Dataset:** `public`" in content
        assert "## Table Metadata" in content
        assert "| **Row Count** | 3 |" in content
        assert "| **Column Count** | 4 |" in content

    def test_description_md_orders(self, synced):
        state, output, config = synced

        content = (
            output
            / "type=databricks"
            / f"database={config.catalog}"
            / "schema=public"
            / "table=orders"
            / "description.md"
        ).read_text()

        assert "| **Row Count** | 2 |" in content
        assert "| **Column Count** | 3 |" in content

    def test_preview_md_users(self, synced):
        state, output, config = synced

        content = (
            output / "type=databricks" / f"database={config.catalog}" / "schema=public" / "table=users" / "preview.md"
        ).read_text()

        assert "# users - Preview" in content
        assert "**Dataset:** `public`" in content
        assert "## Rows (3)" in content

        # Parse the JSONL rows from the markdown
        lines = [line for line in content.splitlines() if line.startswith("- {")]
        rows = [json.loads(line[2:]) for line in lines]

        assert len(rows) == 3
        assert rows[0] == {"id": 1, "name": "Alice", "email": "alice@example.com", "active": True}
        assert rows[1] == {"id": 2, "name": "Bob", "email": None, "active": False}
        assert rows[2] == {"id": 3, "name": "Charlie", "email": "charlie@example.com", "active": True}

    def test_preview_md_orders(self, synced):
        state, output, config = synced

        content = (
            output / "type=databricks" / f"database={config.catalog}" / "schema=public" / "table=orders" / "preview.md"
        ).read_text()

        lines = [line for line in content.splitlines() if line.startswith("- {")]
        rows = [json.loads(line[2:]) for line in lines]

        assert len(rows) == 2
        assert rows[0] == {"id": 1, "user_id": 1, "amount": 99.99}
        assert rows[1] == {"id": 2, "user_id": 1, "amount": 24.5}

    def test_sync_state_tracks_schemas_and_tables(self, synced):
        state, output, config = synced

        assert state.schemas_synced == 1
        assert state.tables_synced == 2
        assert "public" in state.synced_schemas
        assert "users" in state.synced_tables["public"]
        assert "orders" in state.synced_tables["public"]

    def test_include_filter(self, tmp_path_factory, databricks_config):
        """Only tables matching include patterns should be synced."""
        config = DatabricksConfig(
            name=databricks_config.name,
            server_hostname=databricks_config.server_hostname,
            http_path=databricks_config.http_path,
            access_token=databricks_config.access_token,
            catalog=databricks_config.catalog,
            schema_name=databricks_config.schema_name,
            include=["public.users"],
        )

        output = tmp_path_factory.mktemp("databricks_include")
        with Progress(transient=True) as progress:
            state = sync_database(config, output, progress)

        base = output / "type=databricks" / f"database={config.catalog}" / "schema=public"
        assert (base / "table=users").is_dir()
        assert not (base / "table=orders").exists()
        assert state.tables_synced == 1

    def test_exclude_filter(self, tmp_path_factory, databricks_config):
        """Tables matching exclude patterns should be skipped."""
        config = DatabricksConfig(
            name=databricks_config.name,
            server_hostname=databricks_config.server_hostname,
            http_path=databricks_config.http_path,
            access_token=databricks_config.access_token,
            catalog=databricks_config.catalog,
            schema_name=databricks_config.schema_name,
            exclude=["public.orders"],
        )

        output = tmp_path_factory.mktemp("databricks_exclude")
        with Progress(transient=True) as progress:
            state = sync_database(config, output, progress)

        base = output / "type=databricks" / f"database={config.catalog}" / "schema=public"
        assert (base / "table=users").is_dir()
        assert not (base / "table=orders").exists()
        assert state.tables_synced == 1

    def test_sync_all_schemas_when_schema_name_not_specified(self, tmp_path_factory, databricks_config):
        """When schema_name is not provided, all schemas should be synced."""
        config = DatabricksConfig(
            name=databricks_config.name,
            server_hostname=databricks_config.server_hostname,
            http_path=databricks_config.http_path,
            access_token=databricks_config.access_token,
            catalog=databricks_config.catalog,
            schema_name=None,
        )

        output = tmp_path_factory.mktemp("databricks_all_schemas")
        with Progress(transient=True) as progress:
            state = sync_database(config, output, progress)

        # Verify public schema tables
        assert (output / "type=databricks" / f"database={config.catalog}" / "schema=public").is_dir()
        assert (output / "type=databricks" / f"database={config.catalog}" / "schema=public" / "table=users").is_dir()
        assert (output / "type=databricks" / f"database={config.catalog}" / "schema=public" / "table=orders").is_dir()

        # Verify public.users files
        files = sorted(
            f.name
            for f in (
                output / "type=databricks" / f"database={config.catalog}" / "schema=public" / "table=users"
            ).iterdir()
        )
        assert files == ["columns.md", "description.md", "preview.md"]

        # Verify public.orders files
        files = sorted(
            f.name
            for f in (
                output / "type=databricks" / f"database={config.catalog}" / "schema=public" / "table=orders"
            ).iterdir()
        )
        assert files == ["columns.md", "description.md", "preview.md"]

        # Verify another schema table
        assert (output / "type=databricks" / f"database={config.catalog}" / "schema=another").is_dir()
        assert (
            output / "type=databricks" / f"database={config.catalog}" / "schema=another" / "table=whatever"
        ).is_dir()

        # Verify another.whatever files
        files = sorted(
            f.name
            for f in (
                output / "type=databricks" / f"database={config.catalog}" / "schema=another" / "table=whatever"
            ).iterdir()
        )
        assert files == ["columns.md", "description.md", "preview.md"]

        # Verify state
        assert state.schemas_synced == 2
        assert state.tables_synced == 3
        assert "public" in state.synced_schemas
        assert "another" in state.synced_schemas
        assert "users" in state.synced_tables["public"]
        assert "orders" in state.synced_tables["public"]
        assert "whatever" in state.synced_tables["another"]
