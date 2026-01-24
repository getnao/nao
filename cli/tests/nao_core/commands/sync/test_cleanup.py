"""Unit tests for the sync cleanup functionality."""

from pathlib import Path

from nao_core.commands.sync.cleanup import (
    DatabaseSyncState,
    cleanup_stale_database_types,
    cleanup_stale_paths,
)


class TestDatabaseSyncState:
    """Tests for DatabaseSyncState dataclass."""

    def test_initial_state(self, tmp_path: Path):
        """State initializes with empty collections and zero counts."""
        state = DatabaseSyncState(db_path=tmp_path)

        assert state.db_path == tmp_path
        assert state.synced_schemas == set()
        assert state.synced_tables == {}
        assert state.schemas_synced == 0
        assert state.tables_synced == 0

    def test_add_table(self, tmp_path: Path):
        """add_table records schema and table correctly."""
        state = DatabaseSyncState(db_path=tmp_path)

        state.add_table("public", "users")
        state.add_table("public", "orders")
        state.add_table("analytics", "events")

        assert state.synced_schemas == {"public", "analytics"}
        assert state.synced_tables == {
            "public": {"users", "orders"},
            "analytics": {"events"},
        }
        assert state.tables_synced == 3

    def test_add_schema(self, tmp_path: Path):
        """add_schema records schema and increments count."""
        state = DatabaseSyncState(db_path=tmp_path)

        state.add_schema("public")
        state.add_schema("analytics")

        assert state.synced_schemas == {"public", "analytics"}
        assert state.schemas_synced == 2

    def test_add_table_also_adds_schema(self, tmp_path: Path):
        """add_table implicitly adds the schema."""
        state = DatabaseSyncState(db_path=tmp_path)

        state.add_table("public", "users")

        assert "public" in state.synced_schemas


class TestCleanupStalePaths:
    """Tests for cleanup_stale_paths function."""

    def test_no_cleanup_when_db_path_does_not_exist(self, tmp_path: Path):
        """Returns 0 when database path doesn't exist."""
        state = DatabaseSyncState(db_path=tmp_path / "nonexistent")

        removed = cleanup_stale_paths(state)

        assert removed == 0

    def test_removes_stale_table_directory(self, tmp_path: Path):
        """Removes table directories not in synced state."""
        # Create directory structure
        db_path = tmp_path / "type=duckdb" / "database=test"
        schema_path = db_path / "schema=public"
        (schema_path / "table=users").mkdir(parents=True)
        (schema_path / "table=stale_table").mkdir(parents=True)

        # Create state that only includes 'users' table
        state = DatabaseSyncState(db_path=db_path)
        state.add_schema("public")
        state.add_table("public", "users")

        removed = cleanup_stale_paths(state)

        assert removed == 1
        assert (schema_path / "table=users").exists()
        assert not (schema_path / "table=stale_table").exists()

    def test_removes_stale_schema_directory(self, tmp_path: Path):
        """Removes schema directories not in synced state."""
        # Create directory structure
        db_path = tmp_path / "type=duckdb" / "database=test"
        (db_path / "schema=public" / "table=users").mkdir(parents=True)
        (db_path / "schema=stale_schema" / "table=old_table").mkdir(parents=True)

        # Create state that only includes 'public' schema
        state = DatabaseSyncState(db_path=db_path)
        state.add_schema("public")
        state.add_table("public", "users")

        removed = cleanup_stale_paths(state)

        assert removed == 1
        assert (db_path / "schema=public").exists()
        assert not (db_path / "schema=stale_schema").exists()

    def test_removes_multiple_stale_tables(self, tmp_path: Path):
        """Removes multiple stale table directories."""
        # Create directory structure
        db_path = tmp_path / "type=duckdb" / "database=test"
        schema_path = db_path / "schema=public"
        (schema_path / "table=users").mkdir(parents=True)
        (schema_path / "table=stale1").mkdir(parents=True)
        (schema_path / "table=stale2").mkdir(parents=True)
        (schema_path / "table=stale3").mkdir(parents=True)

        # Create state that only includes 'users' table
        state = DatabaseSyncState(db_path=db_path)
        state.add_schema("public")
        state.add_table("public", "users")

        removed = cleanup_stale_paths(state)

        assert removed == 3
        assert (schema_path / "table=users").exists()

    def test_ignores_non_schema_directories(self, tmp_path: Path):
        """Ignores directories that don't start with 'schema='."""
        # Create directory structure
        db_path = tmp_path / "type=duckdb" / "database=test"
        (db_path / "schema=public" / "table=users").mkdir(parents=True)
        (db_path / "other_dir").mkdir(parents=True)  # Should be ignored

        state = DatabaseSyncState(db_path=db_path)
        state.add_schema("public")
        state.add_table("public", "users")

        removed = cleanup_stale_paths(state)

        assert removed == 0
        assert (db_path / "other_dir").exists()

    def test_ignores_non_table_directories(self, tmp_path: Path):
        """Ignores directories that don't start with 'table='."""
        # Create directory structure
        db_path = tmp_path / "type=duckdb" / "database=test"
        schema_path = db_path / "schema=public"
        (schema_path / "table=users").mkdir(parents=True)
        (schema_path / "metadata").mkdir(parents=True)  # Should be ignored

        state = DatabaseSyncState(db_path=db_path)
        state.add_schema("public")
        state.add_table("public", "users")

        removed = cleanup_stale_paths(state)

        assert removed == 0
        assert (schema_path / "metadata").exists()

    def test_no_cleanup_when_everything_synced(self, tmp_path: Path):
        """Returns 0 when all existing paths are in sync state."""
        # Create directory structure
        db_path = tmp_path / "type=duckdb" / "database=test"
        (db_path / "schema=public" / "table=users").mkdir(parents=True)
        (db_path / "schema=public" / "table=orders").mkdir(parents=True)

        # Create state that includes both tables
        state = DatabaseSyncState(db_path=db_path)
        state.add_schema("public")
        state.add_table("public", "users")
        state.add_table("public", "orders")

        removed = cleanup_stale_paths(state)

        assert removed == 0

    def test_removes_table_with_files(self, tmp_path: Path):
        """Removes table directory including all files inside."""
        # Create directory structure with files
        db_path = tmp_path / "type=duckdb" / "database=test"
        schema_path = db_path / "schema=public"
        table_path = schema_path / "table=stale"
        table_path.mkdir(parents=True)
        (table_path / "columns.md").write_text("# Columns")
        (table_path / "preview.md").write_text("# Preview")
        (schema_path / "table=users").mkdir()

        state = DatabaseSyncState(db_path=db_path)
        state.add_schema("public")
        state.add_table("public", "users")

        removed = cleanup_stale_paths(state)

        assert removed == 1
        assert not table_path.exists()


class TestCleanupStaleDatabaseTypes:
    """Tests for cleanup_stale_database_types function."""

    def test_no_cleanup_when_base_path_does_not_exist(self, tmp_path: Path):
        """Returns 0 when base path doesn't exist."""
        removed = cleanup_stale_database_types(
            tmp_path / "nonexistent",
            active_db_types={"type=duckdb"},
        )

        assert removed == 0

    def test_removes_stale_database_type(self, tmp_path: Path):
        """Removes database type directories not in active set."""
        # Create directory structure
        (tmp_path / "type=duckdb" / "database=test").mkdir(parents=True)
        (tmp_path / "type=postgres" / "database=old").mkdir(parents=True)

        removed = cleanup_stale_database_types(
            tmp_path,
            active_db_types={"type=duckdb"},
        )

        assert removed == 1
        assert (tmp_path / "type=duckdb").exists()
        assert not (tmp_path / "type=postgres").exists()

    def test_ignores_non_type_directories(self, tmp_path: Path):
        """Ignores directories that don't start with 'type='."""
        # Create directory structure
        (tmp_path / "type=duckdb").mkdir(parents=True)
        (tmp_path / "some_other_dir").mkdir(parents=True)

        removed = cleanup_stale_database_types(
            tmp_path,
            active_db_types={"type=duckdb"},
        )

        assert removed == 0
        assert (tmp_path / "some_other_dir").exists()

    def test_removes_multiple_stale_types(self, tmp_path: Path):
        """Removes multiple stale database type directories."""
        # Create directory structure
        (tmp_path / "type=duckdb").mkdir(parents=True)
        (tmp_path / "type=postgres").mkdir(parents=True)
        (tmp_path / "type=bigquery").mkdir(parents=True)
        (tmp_path / "type=snowflake").mkdir(parents=True)

        removed = cleanup_stale_database_types(
            tmp_path,
            active_db_types={"type=duckdb"},
        )

        assert removed == 3
        assert (tmp_path / "type=duckdb").exists()
