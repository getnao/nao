"""Integration tests for the database sync pipeline using a real DuckDB database."""

import json

import duckdb
import pytest
from rich.progress import Progress

from nao_core.commands.sync.providers.databases.provider import sync_database
from nao_core.config.databases.duckdb import DuckDBConfig


@pytest.fixture
def duckdb_path(tmp_path):
    """Create a DuckDB database with two tables: users and orders."""
    db_path = tmp_path / "test.duckdb"
    conn = duckdb.connect(str(db_path))

    conn.execute("""
        CREATE TABLE users (
            id INTEGER NOT NULL,
            name VARCHAR NOT NULL,
            email VARCHAR,
            active BOOLEAN DEFAULT TRUE
        )
    """)
    conn.execute("""
        INSERT INTO users VALUES
            (1, 'Alice', 'alice@example.com', true),
            (2, 'Bob', NULL, false),
            (3, 'Charlie', 'charlie@example.com', true)
    """)

    conn.execute("""
        CREATE TABLE orders (
            id INTEGER NOT NULL,
            user_id INTEGER NOT NULL,
            amount DOUBLE NOT NULL
        )
    """)
    conn.execute("""
        INSERT INTO orders VALUES
            (1, 1, 99.99),
            (2, 1, 24.50)
    """)

    conn.close()
    return db_path


class TestDuckDBSyncIntegration:
    def _sync(self, duckdb_path, output_path):
        config = DuckDBConfig(name="test-db", path=str(duckdb_path))

        with Progress(transient=True) as progress:
            state = sync_database(config, output_path, progress)

        return state

    def test_creates_expected_directory_tree(self, tmp_path, duckdb_path):
        output = tmp_path / "output"
        self._sync(duckdb_path, output)

        base = output / "type=duckdb" / "database=test"

        # Schema directory
        assert (base / "schema=main").is_dir()

        # Table directories
        assert (base / "schema=main" / "table=users").is_dir()
        assert (base / "schema=main" / "table=orders").is_dir()

        # Each table should have exactly the 3 default template outputs
        for table in ("users", "orders"):
            table_dir = base / "schema=main" / f"table={table}"
            files = sorted(f.name for f in table_dir.iterdir())
            assert files == ["columns.md", "description.md", "preview.md"]

    def test_columns_md_users(self, tmp_path, duckdb_path):
        output = tmp_path / "output"
        self._sync(duckdb_path, output)

        content = (output / "type=duckdb" / "database=test" / "schema=main" / "table=users" / "columns.md").read_text()

        # NOT NULL columns are prefixed with ! by Ibis (e.g. !int32)
        assert content == (
            "# users\n"
            "\n"
            "**Dataset:** `main`\n"
            "\n"
            "## Columns (4)\n"
            "\n"
            "- id (int32 NOT NULL)\n"
            "- name (string NOT NULL)\n"
            "- email (string)\n"
            "- active (boolean)\n"
        )

    def test_columns_md_orders(self, tmp_path, duckdb_path):
        output = tmp_path / "output"
        self._sync(duckdb_path, output)

        content = (output / "type=duckdb" / "database=test" / "schema=main" / "table=orders" / "columns.md").read_text()

        assert content == (
            "# orders\n"
            "\n"
            "**Dataset:** `main`\n"
            "\n"
            "## Columns (3)\n"
            "\n"
            "- id (int32 NOT NULL)\n"
            "- user_id (int32 NOT NULL)\n"
            "- amount (float64 NOT NULL)\n"
        )

    def test_description_md_users(self, tmp_path, duckdb_path):
        output = tmp_path / "output"
        self._sync(duckdb_path, output)

        content = (
            output / "type=duckdb" / "database=test" / "schema=main" / "table=users" / "description.md"
        ).read_text()

        assert content == (
            "# users\n"
            "\n"
            "**Dataset:** `main`\n"
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

    def test_description_md_orders(self, tmp_path, duckdb_path):
        output = tmp_path / "output"
        self._sync(duckdb_path, output)

        content = (
            output / "type=duckdb" / "database=test" / "schema=main" / "table=orders" / "description.md"
        ).read_text()

        assert "| **Row Count** | 2 |" in content
        assert "| **Column Count** | 3 |" in content

    def test_preview_md_users(self, tmp_path, duckdb_path):
        output = tmp_path / "output"
        self._sync(duckdb_path, output)

        content = (output / "type=duckdb" / "database=test" / "schema=main" / "table=users" / "preview.md").read_text()

        assert "# users - Preview" in content
        assert "**Dataset:** `main`" in content
        assert "## Rows (3)" in content

        # Parse the JSONL rows from the markdown
        lines = [line for line in content.splitlines() if line.startswith("- {")]
        rows = [json.loads(line[2:]) for line in lines]

        assert len(rows) == 3
        assert rows[0] == {"id": 1, "name": "Alice", "email": "alice@example.com", "active": True}
        assert rows[1] == {"id": 2, "name": "Bob", "email": None, "active": False}
        assert rows[2] == {"id": 3, "name": "Charlie", "email": "charlie@example.com", "active": True}

    def test_preview_md_orders(self, tmp_path, duckdb_path):
        output = tmp_path / "output"
        self._sync(duckdb_path, output)

        content = (output / "type=duckdb" / "database=test" / "schema=main" / "table=orders" / "preview.md").read_text()

        lines = [line for line in content.splitlines() if line.startswith("- {")]
        rows = [json.loads(line[2:]) for line in lines]

        assert len(rows) == 2
        assert rows[0] == {"id": 1, "user_id": 1, "amount": 99.99}
        assert rows[1] == {"id": 2, "user_id": 1, "amount": 24.5}

    def test_sync_state_tracks_schemas_and_tables(self, tmp_path, duckdb_path):
        output = tmp_path / "output"
        state = self._sync(duckdb_path, output)

        assert state.schemas_synced == 1
        assert state.tables_synced == 2
        assert "main" in state.synced_schemas
        assert "users" in state.synced_tables["main"]
        assert "orders" in state.synced_tables["main"]

    def test_include_filter(self, tmp_path, duckdb_path):
        """Only tables matching include patterns should be synced."""
        config = DuckDBConfig(name="test-db", path=str(duckdb_path), include=["main.users"])

        output = tmp_path / "output"
        with Progress(transient=True) as progress:
            state = sync_database(config, output, progress)

        base = output / "type=duckdb" / "database=test" / "schema=main"
        assert (base / "table=users").is_dir()
        assert not (base / "table=orders").exists()
        assert state.tables_synced == 1

    def test_exclude_filter(self, tmp_path, duckdb_path):
        """Tables matching exclude patterns should be skipped."""
        config = DuckDBConfig(name="test-db", path=str(duckdb_path), exclude=["main.orders"])

        output = tmp_path / "output"
        with Progress(transient=True) as progress:
            state = sync_database(config, output, progress)

        base = output / "type=duckdb" / "database=test" / "schema=main"
        assert (base / "table=users").is_dir()
        assert not (base / "table=orders").exists()
        assert state.tables_synced == 1
