"""Unit tests for the sync cleanup functionality."""

from dataclasses import dataclass
from pathlib import Path
from typing import List

from nao_core.commands.sync.cleanup import (
    DatabaseSyncState,
    cleanup_stale_databases,
    cleanup_stale_paths,
    cleanup_stale_repos,
    get_database_folder_names,
)
from nao_core.config.repos import RepoConfig


@dataclass
class DBConfig:
    type: str
    name: str = "db"
    project_id: str | None = None
    path: str | None = None
    database: str | None = None

    def get_database_name(self) -> str:
        if self.path:
            return Path(self.path).stem
        if self.database:
            return self.database
        raise ValueError("DBConfig must have either path or database")


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


class TestCleanupStaleDatabases:
    """Tests for cleanup_stale_databases function."""

    def test_removes_stale_database_type(self, tmp_path: Path):
        """Removes database type directories not in active set."""
        (tmp_path / "type=duckdb" / "database=test").mkdir(parents=True)
        (tmp_path / "type=postgres" / "database=old").mkdir(parents=True)

        active_dbs = [
            DBConfig(type="duckdb", path="/tmp/test.duckdb"),
        ]

        cleanup_stale_databases(active_dbs, tmp_path)

        assert (tmp_path / "type=duckdb").exists()
        assert not (tmp_path / "type=postgres").exists()

    def test_removes_multiple_stale_types(self, tmp_path: Path):
        """Removes multiple stale database type directories."""
        (tmp_path / "type=duckdb").mkdir()
        (tmp_path / "type=postgres").mkdir()
        (tmp_path / "type=bigquery").mkdir()
        (tmp_path / "type=snowflake").mkdir()

        active_dbs = [
            DBConfig(type="duckdb", path="/tmp/test.duckdb"),
        ]

        cleanup_stale_databases(active_dbs, tmp_path)

        assert (tmp_path / "type=duckdb").exists()
        assert not (tmp_path / "type=postgres").exists()
        assert not (tmp_path / "type=bigquery").exists()
        assert not (tmp_path / "type=snowflake").exists()

    def test_removes_stale_database_folders_within_type(self, tmp_path: Path):
        """Removes stale database folders inside a valid type."""
        (tmp_path / "type=duckdb" / "database=valid").mkdir(parents=True)
        (tmp_path / "type=duckdb" / "database=old").mkdir(parents=True)

        active_dbs: List[DBConfig] = [
            DBConfig(type="duckdb", path="/tmp/valid.duckdb"),
        ]

        cleanup_stale_databases(active_dbs, tmp_path)

        assert (tmp_path / "type=duckdb" / "database=valid").exists()
        assert not (tmp_path / "type=duckdb" / "database=old").exists()

    def test_keeps_distinct_folders_for_duplicate_type_and_database(self, tmp_path: Path):
        """Duplicate (type, database) configs should map to different folders."""
        (tmp_path / "type=clickhouse" / "database=primary").mkdir(parents=True)
        (tmp_path / "type=clickhouse" / "database=secondary").mkdir(parents=True)
        (tmp_path / "type=clickhouse" / "database=default").mkdir(parents=True)  # stale legacy/colliding path

        active_dbs: List[DBConfig] = [
            DBConfig(type="clickhouse", name="primary", database="default"),
            DBConfig(type="clickhouse", name="secondary", database="default"),
        ]

        cleanup_stale_databases(active_dbs, tmp_path)

        assert (tmp_path / "type=clickhouse" / "database=primary").exists()
        assert (tmp_path / "type=clickhouse" / "database=secondary").exists()
        assert not (tmp_path / "type=clickhouse" / "database=default").exists()

    def test_database_folder_names_clickhouse_uses_config_name_only(self):
        active_dbs: List[DBConfig] = [
            DBConfig(type="clickhouse", name="last", database="default"),
            DBConfig(type="clickhouse", name="numia", database="default"),
            DBConfig(type="clickhouse", name="unique", database="analytics"),
            DBConfig(type="duckdb", name="analytics-copy", path="/tmp/analytics.db"),
            DBConfig(type="duckdb", name="analytics-copy-2", path="/tmp/analytics.db"),
        ]

        folders = get_database_folder_names(active_dbs)

        assert folders == [
            "database=last",
            "database=numia",
            "database=unique",
            "database=analytics",
            "database=analytics",
        ]


class TestCleanupStaleRespositories:
    def test_remove_unused_repos(self, tmp_path: Path):
        base_path = tmp_path / "repos"
        base_path.mkdir()

        create_repo_dir(base_path, "repo1")
        create_repo_dir(base_path, "repo2")
        create_repo_dir(base_path, "old_repo")

        config_repos = [
            RepoConfig(name="repo1", url="https://example.com/repo1.git"),
            RepoConfig(name="repo2", url="https://example.com/repo2.git"),
        ]

        cleanup_stale_repos(config_repos, base_path)

        remaining = {p.name for p in base_path.iterdir() if p.is_dir()}
        assert remaining == {"repo1", "repo2"}
        assert not (base_path / "old_repo").exists()


def create_repo_dir(base: Path, name: str) -> Path:
    repo = base / name
    repo.mkdir(parents=True)
    (repo / "README.md").write_text("dummy")
    return repo
