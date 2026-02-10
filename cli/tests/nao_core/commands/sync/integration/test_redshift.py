"""Integration tests for the database sync pipeline against a real Redshift cluster.

Connection is configured via environment variables:
    REDSHIFT_HOST, REDSHIFT_PORT (default 5439), REDSHIFT_DATABASE,
    REDSHIFT_USER, REDSHIFT_PASSWORD, REDSHIFT_SCHEMA (default public),
    REDSHIFT_SSLMODE (default require).

The test suite is skipped entirely when REDSHIFT_HOST is not set.
"""

import json
import os

import pytest
from rich.progress import Progress

from nao_core.commands.sync.providers.databases.provider import sync_database
from nao_core.config.databases.redshift import RedshiftConfig

REDSHIFT_HOST = os.environ.get("REDSHIFT_HOST")

pytestmark = pytest.mark.skipif(
    REDSHIFT_HOST is None, reason="REDSHIFT_HOST not set — skipping Redshift integration tests"
)

# ibis uses pg_catalog.pg_enum which Redshift does not support
KNOWN_ERROR = "pg_catalog.pg_enum"


@pytest.fixture(scope="module")
def redshift_config():
    """Build a RedshiftConfig from environment variables."""
    return RedshiftConfig(
        name="test-redshift",
        host=os.environ["REDSHIFT_HOST"],
        port=int(os.environ.get("REDSHIFT_PORT", "5439")),
        database=os.environ["REDSHIFT_DATABASE"],
        user=os.environ["REDSHIFT_USER"],
        password=os.environ["REDSHIFT_PASSWORD"],
        schema_name=os.environ.get("REDSHIFT_SCHEMA", "public"),
        sslmode=os.environ.get("REDSHIFT_SSLMODE", "require"),
    )


@pytest.fixture(scope="module")
def synced(tmp_path_factory, redshift_config):
    """Run sync once for the whole module and return (state, output_path, config)."""
    output = tmp_path_factory.mktemp("redshift_sync")

    with Progress(transient=True) as progress:
        state = sync_database(redshift_config, output, progress)

    return state, output, redshift_config


class TestRedshiftSyncIntegration:
    """Verify the sync pipeline produces correct output against a live Redshift cluster."""

    def test_creates_expected_directory_tree(self, synced):
        state, output, config = synced

        base = output / "type=redshift" / "database=nao_unit_tests" / "schema=public"

        # Schema directory
        assert base.is_dir()

        # Each table should have exactly the 3 default template outputs
        for table in ("orders", "users"):
            assert (base / f"table={table}").is_dir()
            table_dir = base / f"table={table}"
            files = sorted(f.name for f in table_dir.iterdir())
            assert files == ["columns.md", "description.md", "preview.md"]

    def test_columns_md_users(self, synced):
        state, output, config = synced

        content = (
            output / "type=redshift" / "database=nao_unit_tests" / "schema=public" / "table=users" / "columns.md"
        ).read_text()

        # NOT NULL columns are prefixed with ! by Ibis (e.g. !int32)
        assert content == (
            "# users\n"
            "\n"
            "**Dataset:** `public`\n"
            "\n"
            "## Columns (4)\n"
            "\n"
            "- id (int32 NOT NULL)\n"
            "- name (string NOT NULL)\n"
            "- email (string)\n"
            "- active (boolean)\n"
        )

    def test_columns_md_orders(self, synced):
        state, output, config = synced

        content = (
            output / "type=redshift" / "database=nao_unit_tests" / "schema=public" / "table=orders" / "columns.md"
        ).read_text()

        assert content == (
            "# orders\n"
            "\n"
            "**Dataset:** `public`\n"
            "\n"
            "## Columns (3)\n"
            "\n"
            "- id (int32 NOT NULL)\n"
            "- user_id (int32 NOT NULL)\n"
            "- amount (float32 NOT NULL)\n"
        )

    def test_description_md_users(self, synced):
        state, output, config = synced

        content = (
            output / "type=redshift" / "database=nao_unit_tests" / "schema=public" / "table=users" / "description.md"
        ).read_text()

        assert content == (
            "# users\n"
            "\n"
            "**Dataset:** `public`\n"
            "\n"
            "## Table Metadata\n"
            "\n"
            "| Property | Value |\n"
            "|----------|-------|\n"
            "| **Row Count** | 3 |\n"
            "| **Column Count** | 4 |\n"
            "\n"
            "## Description\n"
            "\n"
            "_No description available._\n"
        )

    def test_description_md_orders(self, synced):
        state, output, config = synced

        content = (
            output / "type=redshift" / "database=nao_unit_tests" / "schema=public" / "table=orders" / "description.md"
        ).read_text()

        assert "| **Row Count** | 2 |" in content
        assert "| **Column Count** | 3 |" in content

    def test_preview_md_users(self, synced):
        state, output, config = synced

        content = (
            output / "type=redshift" / "database=nao_unit_tests" / "schema=public" / "table=users" / "preview.md"
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
            output / "type=redshift" / "database=nao_unit_tests" / "schema=public" / "table=orders" / "preview.md"
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

    def test_include_filter(self, tmp_path_factory, redshift_config):
        """Only tables matching include patterns should be synced."""
        config = RedshiftConfig(
            name=redshift_config.name,
            host=redshift_config.host,
            port=redshift_config.port,
            database=redshift_config.database,
            user=redshift_config.user,
            password=redshift_config.password,
            schema_name=redshift_config.schema_name,
            sslmode=redshift_config.sslmode,
            include=["public.users"],
        )

        output = tmp_path_factory.mktemp("redshift_include")
        with Progress(transient=True) as progress:
            state = sync_database(config, output, progress)

        base = output / "type=redshift" / "database=nao_unit_tests" / "schema=public"
        assert (base / "table=users").is_dir()
        assert not (base / "table=orders").exists()
        assert state.tables_synced == 1

    def test_exclude_filter(self, tmp_path_factory, redshift_config):
        """Tables matching exclude patterns should be skipped."""
        config = RedshiftConfig(
            name=redshift_config.name,
            host=redshift_config.host,
            port=redshift_config.port,
            database=redshift_config.database,
            user=redshift_config.user,
            password=redshift_config.password,
            schema_name=redshift_config.schema_name,
            sslmode=redshift_config.sslmode,
            exclude=["public.orders"],
        )

        output = tmp_path_factory.mktemp("redshift_exclude")
        with Progress(transient=True) as progress:
            state = sync_database(config, output, progress)

        base = output / "type=redshift" / "database=nao_unit_tests" / "schema=public"
        assert (base / "table=users").is_dir()
        assert not (base / "table=orders").exists()
        assert state.tables_synced == 1

    def test_sync_all_schemas_when_schema_name_not_specified(self, tmp_path_factory, redshift_config):
        """When schema_name is not provided, all schemas should be synced."""
        config = RedshiftConfig(
            name=redshift_config.name,
            host=redshift_config.host,
            port=redshift_config.port,
            database=redshift_config.database,
            user=redshift_config.user,
            password=redshift_config.password,
            schema_name=None,
            sslmode=redshift_config.sslmode,
        )

        output = tmp_path_factory.mktemp("redshift_all_schemas")
        with Progress(transient=True) as progress:
            state = sync_database(config, output, progress)

        # Verify public schema tables
        assert (output / "type=redshift" / "database=nao_unit_tests" / "schema=public").is_dir()
        assert (output / "type=redshift" / "database=nao_unit_tests" / "schema=public" / "table=users").is_dir()
        assert (output / "type=redshift" / "database=nao_unit_tests" / "schema=public" / "table=orders").is_dir()

        # Verify public.users files
        files = sorted(
            f.name
            for f in (output / "type=redshift" / "database=nao_unit_tests" / "schema=public" / "table=users").iterdir()
        )
        assert files == ["columns.md", "description.md", "preview.md"]

        # Verify public.orders files
        files = sorted(
            f.name
            for f in (output / "type=redshift" / "database=nao_unit_tests" / "schema=public" / "table=orders").iterdir()
        )
        assert files == ["columns.md", "description.md", "preview.md"]

        # Verify another schema table
        assert (output / "type=redshift" / "database=nao_unit_tests" / "schema=another").is_dir()
        assert (output / "type=redshift" / "database=nao_unit_tests" / "schema=another" / "table=whatever").is_dir()

        # Verify another.whatever files
        files = sorted(
            f.name
            for f in (
                output / "type=redshift" / "database=nao_unit_tests" / "schema=another" / "table=whatever"
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
