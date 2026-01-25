"""Cleanup utilities for removing stale sync files."""

import shutil
from collections import defaultdict
from dataclasses import dataclass, field
from pathlib import Path
from typing import Dict, List

from rich.console import Console

console = Console()


@dataclass
class DatabaseSyncState:
    """Tracks the state of a database sync operation.

    Used to track which paths were synced so stale paths can be cleaned up.
    """

    db_path: Path
    """The root path for this database (e.g., databases/type=duckdb/database=mydb)"""

    synced_schemas: set[str] = field(default_factory=set)
    """Set of schema names that were synced"""

    synced_tables: dict[str, set[str]] = field(default_factory=dict)
    """Dict mapping schema names to sets of table names that were synced"""

    schemas_synced: int = 0
    """Count of schemas synced"""

    tables_synced: int = 0
    """Count of tables synced"""

    def add_table(self, schema: str, table: str) -> None:
        """Record that a table was synced.

        Args:
            schema: The schema/dataset name
            table: The table name
        """
        self.synced_schemas.add(schema)
        if schema not in self.synced_tables:
            self.synced_tables[schema] = set()
        self.synced_tables[schema].add(table)
        self.tables_synced += 1

    def add_schema(self, schema: str) -> None:
        """Record that a schema was synced (even if empty).

        Args:
            schema: The schema/dataset name
        """
        self.synced_schemas.add(schema)
        self.schemas_synced += 1


def cleanup_stale_paths(state: DatabaseSyncState, verbose: bool = False) -> int:
    """Remove directories that exist on disk but weren't synced.

    This function cleans up:
    - Table directories that no longer exist in the source
    - Schema directories that no longer exist or have no tables

    Args:
        state: The sync state tracking what was synced
        verbose: Whether to print cleanup messages

    Returns:
        Number of stale paths removed
    """
    removed_count = 0

    if not state.db_path.exists():
        return 0

    # Find all existing schema directories
    existing_schemas = {
        d.name.replace("schema=", ""): d for d in state.db_path.iterdir() if d.is_dir() and d.name.startswith("schema=")
    }

    # Remove schemas that weren't synced
    for schema_name, schema_path in existing_schemas.items():
        if schema_name not in state.synced_schemas:
            if verbose:
                console.print(f"  [dim red]removing stale schema:[/dim red] {schema_name}")
            shutil.rmtree(schema_path)
            removed_count += 1
            continue

        # Find existing tables in this schema
        existing_tables = {
            d.name.replace("table=", ""): d for d in schema_path.iterdir() if d.is_dir() and d.name.startswith("table=")
        }

        synced_tables_for_schema = state.synced_tables.get(schema_name, set())

        # Remove tables that weren't synced
        for table_name, table_path in existing_tables.items():
            if table_name not in synced_tables_for_schema:
                if verbose:
                    console.print(f"  [dim red]removing stale table:[/dim red] {schema_name}.{table_name}")
                shutil.rmtree(table_path)
                removed_count += 1

    return removed_count


def cleanup_stale_databases(active_databases: List, base_path: Path, verbose: bool = False):
    """Remove databases that are not present in the config file."""

    valid_db_folders_by_type: Dict[str, set] = defaultdict(set)

    for db in active_databases:
        type_folder = f"type={db.type}"
        db_identifier = get_database_identifier(db)
        db_folder = f"database={db_identifier}"

        valid_db_folders_by_type[type_folder].add(db_folder)

    for type_dir in base_path.iterdir():
        if not type_dir.is_dir():
            continue

        type_folder_name = type_dir.name

        # Remove entire type directory if it doesn't exist in nao_config
        if type_folder_name not in valid_db_folders_by_type:
            shutil.rmtree(type_dir)
            if verbose:
                console.print(f"\n[yellow] Removed unused database type:[/yellow] {type_dir}")
            continue

        valid_db_folders = valid_db_folders_by_type[type_folder_name]

        # Remove unused database folders if it doesn't exist in nao_config
        for db_dir in type_dir.iterdir():
            if not db_dir.is_dir():
                continue

            if db_dir.name not in valid_db_folders:
                shutil.rmtree(db_dir)
                if verbose:
                    console.print(f"\n[yellow] Removed unused database:[/yellow] {type_folder_name}/{db_dir.name}")


def get_database_identifier(db):
    if db.type == "bigquery":
        return db.project_id

    elif db.type == "duckdb":
        if db.path == ":memory:":
            return "memory"
        return Path(db.path).stem

    elif db.type == "databricks":
        return db.catalog or "main"

    elif db.type == "snowflake":
        return db.database

    elif db.type == "postgres":
        return db.database


def cleanup_stale_repos(config_repos: list, base_path: Path, verbose: bool = False) -> None:
    """Remove repositories that are not present in the config file."""

    repo_names = {repo.name for repo in config_repos}
    for repo_dir in base_path.iterdir():
        if repo_dir.is_dir() and repo_dir.name not in repo_names:
            shutil.rmtree(repo_dir)
            if verbose:
                console.print(f"\n[yellow] Removed unused repo:[/yellow] {repo_dir.name}")
