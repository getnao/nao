"""Integration tests for the database sync pipeline against a real Snowflake database.

Connection is configured via environment variables:
    SNOWFLAKE_ACCOUNT_ID, SNOWFLAKE_USERNAME
    SNOWFLAKE_PRIVATE_KEY_PATH, SNOWFLAKE_PASSPHRASE (optional),
    SNOWFLAKE_SCHEMA (default public), SNOWFLAKE_WAREHOUSE (optional).

The test suite is skipped entirely when SNOWFLAKE_ACCOUNT_ID is not set.
"""

import json
import os
import uuid
from pathlib import Path

import ibis
import pytest
from cryptography.hazmat.backends import default_backend
from cryptography.hazmat.primitives import serialization
from rich.progress import Progress

from nao_core.commands.sync.providers.databases.provider import sync_database
from nao_core.config.databases.snowflake import SnowflakeConfig

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
def snowflake_config(temp_database):
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
def synced(tmp_path_factory, snowflake_config):
    """Run sync once for the whole module and return (state, output_path, config)."""
    output = tmp_path_factory.mktemp("snowflake_sync")

    with Progress(transient=True) as progress:
        state = sync_database(snowflake_config, output, progress)

    return state, output, snowflake_config


class TestSnowflakeSyncIntegration:
    """Verify the sync pipeline produces correct output against a live Snowflake database."""

    def test_creates_expected_directory_tree(self, synced):
        state, output, config = synced

        base = output / "type=snowflake" / f"database={config.database}" / "schema=public"

        # Schema directory
        assert base.is_dir()

        # Each table should have exactly the 3 default template outputs
        for table in ("orders", "users"):
            assert (base / f"table={table}").is_dir()
            table_dir = base / f"table={table}"
            files = sorted(f.name for f in table_dir.iterdir())
            assert files == ["columns.md", "description.md", "preview.md"]

        # Verify that the "another" schema was NOT synced
        another_schema_dir = output / "type=snowflake" / f"database={config.database}" / "schema=another"
        assert not another_schema_dir.exists()

    def test_columns_md_users(self, synced):
        state, output, config = synced

        content = (
            output / "type=snowflake" / f"database={config.database}" / "schema=public" / "table=users" / "columns.md"
        ).read_text()

        # Snowflake stores identifiers in uppercase by default
        assert "# USERS" in content
        assert "**Dataset:** `PUBLIC`" in content
        assert "## Columns (4)" in content
        assert "- ID" in content
        assert "- NAME" in content
        assert "- EMAIL" in content
        assert "- ACTIVE" in content

    def test_columns_md_orders(self, synced):
        state, output, config = synced

        content = (
            output / "type=snowflake" / f"database={config.database}" / "schema=public" / "table=orders" / "columns.md"
        ).read_text()

        assert "# ORDERS" in content
        assert "**Dataset:** `PUBLIC`" in content
        assert "## Columns (3)" in content
        assert "- ID" in content
        assert "- USER_ID" in content
        assert "- AMOUNT" in content

    def test_description_md_users(self, synced):
        state, output, config = synced

        content = (
            output
            / "type=snowflake"
            / f"database={config.database}"
            / "schema=public"
            / "table=users"
            / "description.md"
        ).read_text()

        assert "# USERS" in content
        assert "**Dataset:** `PUBLIC`" in content
        assert "## Table Metadata" in content
        assert "| **Row Count** | 3 |" in content
        assert "| **Column Count** | 4 |" in content

    def test_description_md_orders(self, synced):
        state, output, config = synced

        content = (
            output
            / "type=snowflake"
            / f"database={config.database}"
            / "schema=public"
            / "table=orders"
            / "description.md"
        ).read_text()

        assert "| **Row Count** | 2 |" in content
        assert "| **Column Count** | 3 |" in content

    def test_preview_md_users(self, synced):
        state, output, config = synced

        content = (
            output / "type=snowflake" / f"database={config.database}" / "schema=public" / "table=users" / "preview.md"
        ).read_text()

        assert "# USERS - Preview" in content
        assert "**Dataset:** `PUBLIC`" in content
        assert "## Rows (3)" in content

        # Parse the JSONL rows from the markdown
        lines = [line for line in content.splitlines() if line.startswith("- {")]
        rows = [json.loads(line[2:]) for line in lines]

        assert len(rows) == 3
        # Snowflake returns column names in uppercase
        assert rows[0] == {"ID": 1, "NAME": "Alice", "EMAIL": "alice@example.com", "ACTIVE": True}
        assert rows[1] == {"ID": 2, "NAME": "Bob", "EMAIL": None, "ACTIVE": False}
        assert rows[2] == {"ID": 3, "NAME": "Charlie", "EMAIL": "charlie@example.com", "ACTIVE": True}

    def test_preview_md_orders(self, synced):
        state, output, config = synced

        content = (
            output / "type=snowflake" / f"database={config.database}" / "schema=public" / "table=orders" / "preview.md"
        ).read_text()

        lines = [line for line in content.splitlines() if line.startswith("- {")]
        rows = [json.loads(line[2:]) for line in lines]

        assert len(rows) == 2
        # Snowflake returns column names in uppercase and integers as floats
        assert rows[0] == {"ID": 1.0, "USER_ID": 1.0, "AMOUNT": 99.99}
        assert rows[1] == {"ID": 2.0, "USER_ID": 1.0, "AMOUNT": 24.5}

    def test_sync_state_tracks_schemas_and_tables(self, synced):
        state, output, config = synced

        assert state.schemas_synced == 1
        assert state.tables_synced == 2
        # Snowflake stores schema and table names in uppercase
        assert "PUBLIC" in state.synced_schemas
        assert "USERS" in state.synced_tables["PUBLIC"]
        assert "ORDERS" in state.synced_tables["PUBLIC"]

    def test_include_filter(self, tmp_path_factory, snowflake_config):
        """Only tables matching include patterns should be synced."""
        config = SnowflakeConfig(
            name=snowflake_config.name,
            account_id=snowflake_config.account_id,
            username=snowflake_config.username,
            database=snowflake_config.database,
            private_key_path=snowflake_config.private_key_path,
            passphrase=snowflake_config.passphrase,
            schema_name=snowflake_config.schema_name,
            warehouse=snowflake_config.warehouse,
            include=["public.users"],
        )

        output = tmp_path_factory.mktemp("snowflake_include")
        with Progress(transient=True) as progress:
            state = sync_database(config, output, progress)

        # Snowflake uses uppercase names for schemas and tables
        base = output / "type=snowflake" / f"database={config.database}" / "schema=PUBLIC"
        assert (base / "table=USERS").is_dir()
        assert not (base / "table=ORDERS").exists()
        assert state.tables_synced == 1

    def test_exclude_filter(self, tmp_path_factory, snowflake_config):
        """Tables matching exclude patterns should be skipped."""
        config = SnowflakeConfig(
            name=snowflake_config.name,
            account_id=snowflake_config.account_id,
            username=snowflake_config.username,
            database=snowflake_config.database,
            private_key_path=snowflake_config.private_key_path,
            passphrase=snowflake_config.passphrase,
            schema_name=snowflake_config.schema_name,
            warehouse=snowflake_config.warehouse,
            exclude=["public.orders"],
        )

        output = tmp_path_factory.mktemp("snowflake_exclude")
        with Progress(transient=True) as progress:
            state = sync_database(config, output, progress)

        # Snowflake uses uppercase names for schemas and tables
        base = output / "type=snowflake" / f"database={config.database}" / "schema=PUBLIC"
        assert (base / "table=USERS").is_dir()
        assert not (base / "table=ORDERS").exists()
        assert state.tables_synced == 1

    def test_sync_all_schemas_when_schema_name_not_specified(self, tmp_path_factory, snowflake_config):
        """When schema_name is not provided, all schemas should be synced."""
        config = SnowflakeConfig(
            name=snowflake_config.name,
            account_id=snowflake_config.account_id,
            username=snowflake_config.username,
            database=snowflake_config.database,
            private_key_path=snowflake_config.private_key_path,
            passphrase=snowflake_config.passphrase,
            schema_name=None,
            warehouse=snowflake_config.warehouse,
        )

        output = tmp_path_factory.mktemp("snowflake_all_schemas")
        with Progress(transient=True) as progress:
            state = sync_database(config, output, progress)

        # Verify PUBLIC schema tables (Snowflake uses uppercase names)
        assert (output / "type=snowflake" / f"database={config.database}" / "schema=PUBLIC").is_dir()
        assert (output / "type=snowflake" / f"database={config.database}" / "schema=PUBLIC" / "table=USERS").is_dir()
        assert (output / "type=snowflake" / f"database={config.database}" / "schema=PUBLIC" / "table=ORDERS").is_dir()

        # Verify PUBLIC.USERS files
        files = sorted(
            f.name
            for f in (
                output / "type=snowflake" / f"database={config.database}" / "schema=PUBLIC" / "table=USERS"
            ).iterdir()
        )
        assert files == ["columns.md", "description.md", "preview.md"]

        # Verify PUBLIC.ORDERS files
        files = sorted(
            f.name
            for f in (
                output / "type=snowflake" / f"database={config.database}" / "schema=PUBLIC" / "table=ORDERS"
            ).iterdir()
        )
        assert files == ["columns.md", "description.md", "preview.md"]

        # Verify ANOTHER schema table
        assert (output / "type=snowflake" / f"database={config.database}" / "schema=ANOTHER").is_dir()
        assert (
            output / "type=snowflake" / f"database={config.database}" / "schema=ANOTHER" / "table=WHATEVER"
        ).is_dir()

        # Verify ANOTHER.WHATEVER files
        files = sorted(
            f.name
            for f in (
                output / "type=snowflake" / f"database={config.database}" / "schema=ANOTHER" / "table=WHATEVER"
            ).iterdir()
        )
        assert files == ["columns.md", "description.md", "preview.md"]

        # Verify state
        assert state.schemas_synced == 2
        assert state.tables_synced == 3
        assert "PUBLIC" in state.synced_schemas
        assert "ANOTHER" in state.synced_schemas
        assert "USERS" in state.synced_tables["PUBLIC"]
        assert "ORDERS" in state.synced_tables["PUBLIC"]
        assert "WHATEVER" in state.synced_tables["ANOTHER"]
