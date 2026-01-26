"""Cleanup utilities for removing stale sync files."""

import shutil
from dataclasses import dataclass, field
from pathlib import Path

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


def cleanup_stale_database_types(base_path: Path, active_db_types: set[str], verbose: bool = False) -> int:
    """Remove database type directories that are no longer configured.

    Args:
        base_path: The base databases output path
        active_db_types: Set of database type directory names that should exist
                         (e.g., {'type=duckdb', 'type=postgres'})
        verbose: Whether to print cleanup messages

    Returns:
        Number of stale database type directories removed
    """
    removed_count = 0

    if not base_path.exists():
        return 0

    for db_type_dir in base_path.iterdir():
        if db_type_dir.is_dir() and db_type_dir.name.startswith("type="):
            if db_type_dir.name not in active_db_types:
                if verbose:
                    console.print(f"  [dim red]removing stale database type:[/dim red] {db_type_dir.name}")
                shutil.rmtree(db_type_dir)
                removed_count += 1

    return removed_count
