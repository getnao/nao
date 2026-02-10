"""Integration tests for the database sync pipeline against a real Postgres database.

Connection is configured via environment variables:
    POSTGRES_HOST, POSTGRES_PORT (default 5432), POSTGRES_DATABASE,
    POSTGRES_USER, POSTGRES_PASSWORD,
    POSTGRES_SCHEMA (default public).

The test suite is skipped entirely when POSTGRES_HOST is not set.
"""

import json
import os
import uuid
from pathlib import Path

import ibis
import pytest
from rich.progress import Progress

from nao_core.commands.sync.providers.databases.provider import sync_database
from nao_core.config.databases.postgres import PostgresConfig

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
def postgres_config(temp_database):
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
def synced(tmp_path_factory, postgres_config):
    """Run sync once for the whole module and return (state, output_path, config)."""
    output = tmp_path_factory.mktemp("postgres_sync")

    with Progress(transient=True) as progress:
        state = sync_database(postgres_config, output, progress)

    return state, output, postgres_config


class TestPostgresSyncIntegration:
    """Verify the sync pipeline produces correct output against a live Postgres database."""

    def test_creates_expected_directory_tree(self, synced):
        state, output, config = synced

        base = output / "type=postgres" / f"database={config.database}" / "schema=public"

        # Schema directory
        assert base.is_dir()

        # Each table should have exactly the 3 default template outputs
        for table in ("orders", "users"):
            assert (base / f"table={table}").is_dir()
            table_dir = base / f"table={table}"
            files = sorted(f.name for f in table_dir.iterdir())
            assert files == ["columns.md", "description.md", "preview.md"]

        # Verify that the "another" schema was NOT synced
        another_schema_dir = output / "type=postgres" / f"database={config.database}" / "schema=another"
        assert not another_schema_dir.exists()

    def test_columns_md_users(self, synced):
        state, output, config = synced

        content = (
            output / "type=postgres" / f"database={config.database}" / "schema=public" / "table=users" / "columns.md"
        ).read_text()

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
            output / "type=postgres" / f"database={config.database}" / "schema=public" / "table=orders" / "columns.md"
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
            / "type=postgres"
            / f"database={config.database}"
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
            / "type=postgres"
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
            output / "type=postgres" / f"database={config.database}" / "schema=public" / "table=users" / "preview.md"
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
            output / "type=postgres" / f"database={config.database}" / "schema=public" / "table=orders" / "preview.md"
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

    def test_include_filter(self, tmp_path_factory, postgres_config):
        """Only tables matching include patterns should be synced."""
        config = PostgresConfig(
            name=postgres_config.name,
            host=postgres_config.host,
            port=postgres_config.port,
            database=postgres_config.database,
            user=postgres_config.user,
            password=postgres_config.password,
            schema_name=postgres_config.schema_name,
            include=["public.users"],
        )

        output = tmp_path_factory.mktemp("postgres_include")
        with Progress(transient=True) as progress:
            state = sync_database(config, output, progress)

        base = output / "type=postgres" / f"database={config.database}" / "schema=public"
        assert (base / "table=users").is_dir()
        assert not (base / "table=orders").exists()
        assert state.tables_synced == 1

    def test_exclude_filter(self, tmp_path_factory, postgres_config):
        """Tables matching exclude patterns should be skipped."""
        config = PostgresConfig(
            name=postgres_config.name,
            host=postgres_config.host,
            port=postgres_config.port,
            database=postgres_config.database,
            user=postgres_config.user,
            password=postgres_config.password,
            schema_name=postgres_config.schema_name,
            exclude=["public.orders"],
        )

        output = tmp_path_factory.mktemp("postgres_exclude")
        with Progress(transient=True) as progress:
            state = sync_database(config, output, progress)

        base = output / "type=postgres" / f"database={config.database}" / "schema=public"
        assert (base / "table=users").is_dir()
        assert not (base / "table=orders").exists()
        assert state.tables_synced == 1

    def test_sync_all_schemas_when_schema_name_not_specified(self, tmp_path_factory, postgres_config):
        """When schema_name is not provided, all schemas should be synced."""
        config = PostgresConfig(
            name=postgres_config.name,
            host=postgres_config.host,
            port=postgres_config.port,
            database=postgres_config.database,
            user=postgres_config.user,
            password=postgres_config.password,
            schema_name=None,
        )

        output = tmp_path_factory.mktemp("postgres_all_schemas")
        with Progress(transient=True) as progress:
            state = sync_database(config, output, progress)

        # Verify public schema tables
        assert (output / "type=postgres" / f"database={config.database}" / "schema=public").is_dir()
        assert (output / "type=postgres" / f"database={config.database}" / "schema=public" / "table=users").is_dir()
        assert (output / "type=postgres" / f"database={config.database}" / "schema=public" / "table=orders").is_dir()

        # Verify public.users files
        files = sorted(
            f.name
            for f in (
                output / "type=postgres" / f"database={config.database}" / "schema=public" / "table=users"
            ).iterdir()
        )
        assert files == ["columns.md", "description.md", "preview.md"]

        # Verify public.orders files
        files = sorted(
            f.name
            for f in (
                output / "type=postgres" / f"database={config.database}" / "schema=public" / "table=orders"
            ).iterdir()
        )
        assert files == ["columns.md", "description.md", "preview.md"]

        # Verify another schema table
        assert (output / "type=postgres" / f"database={config.database}" / "schema=another").is_dir()
        assert (output / "type=postgres" / f"database={config.database}" / "schema=another" / "table=whatever").is_dir()

        # Verify another.whatever files
        files = sorted(
            f.name
            for f in (
                output / "type=postgres" / f"database={config.database}" / "schema=another" / "table=whatever"
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
