"""Cleanup utilities for removing stale sync files."""

import re
import shutil
from collections import defaultdict
from dataclasses import dataclass, field
from pathlib import Path
from typing import Dict, List, Set

from rich.console import Console

console = Console()


# All template output filenames that the database sync has ever produced.
# Used to identify files that are safe to delete when their template is no
# longer configured. User-authored files (annotations.md, anything not in this
# set) are never touched.
TEMPLATE_OUTPUT_FILES: Set[str] = {
    # Current templates (cli/nao_core/templates/defaults/databases/)
    "columns.md",
    "query_history.md",
    "preview.md",
    "profiling.md",
    "ai_summary.md",
    # Legacy names from earlier versions
    "how_to_use.md",  # renamed to query_history.md in #1043
    "description.md",  # removed in #1043
}


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


def _sanitize_folder_part(value: str) -> str:
    """Sanitize arbitrary text for stable folder naming."""
    sanitized = re.sub(r"[^A-Za-z0-9._-]+", "_", value.strip())
    return sanitized.strip("_") or "connection"


def get_database_folder_names(active_databases: List) -> list[str]:
    """Return deterministic database folder names for configured databases.

    Default folder is `database=<db_name>`.
    For ClickHouse, use config name (`database=<config_name>`) because many
    connections use the same logical database name (often `default`).
    """
    folders: list[str] = []

    for db in active_databases:
        if db.type == "clickhouse":
            config_name = _sanitize_folder_part(str(getattr(db, "name", "connection")))
            folders.append(f"database={config_name}")
            continue

        folders.append(f"database={db.get_database_name()}")

    return folders


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
    if not base_path.exists():
        return

    valid_db_folders_by_type: Dict[str, set] = defaultdict(set)
    db_folders = get_database_folder_names(active_databases)
    for db, db_folder in zip(active_databases, db_folders, strict=False):
        type_folder = f"type={db.type}"
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


def cleanup_stale_repos(config_repos: list, base_path: Path, verbose: bool = False) -> None:
    """Remove repositories that are not present in the config file."""

    if not base_path.exists():
        return

    repo_names = {repo.name for repo in config_repos}
    for repo_dir in base_path.iterdir():
        if repo_dir.is_dir() and repo_dir.name not in repo_names:
            shutil.rmtree(repo_dir)
            if verbose:
                console.print(f"\n[yellow] Removed unused repo:[/yellow] {repo_dir.name}")


def cleanup_stale_table_files(
    state: DatabaseSyncState,
    expected_filenames: Set[str],
    verbose: bool = False,
) -> int:
    """Remove template-managed files that are no longer configured.

    Walks every synced table directory under ``state.db_path`` and removes
    files that are in the legacy-or-current known template set (see
    :data:`TEMPLATE_OUTPUT_FILES`) but NOT in ``expected_filenames``.
    User-authored files (anything not in the known set, including
    ``annotations.md``) are never deleted.

    This generalises the per-file cleanup that already exists for the
    Notion provider (``cleanup_stale_pages``) to database table folders,
    so a user who removes a template from ``nao_config.yaml`` (or picks
    up the ``#1043`` rename from ``how_to_use.md`` to
    ``query_history.md``) no longer accumulates orphan files on every
    subsequent sync.

    Args:
        state: The sync state tracking which tables were synced.
        expected_filenames: Set of template filenames that the current
            config expects (e.g. ``{"preview.md", "columns.md"}``). Files
            in :data:`TEMPLATE_OUTPUT_FILES` that are NOT in this set
            are removed. Templates that are configured but skipped this
            run (e.g. ``profiling.md`` under a ``once``/``interval``
            refresh policy) should still appear in this set so the
            existing file is preserved.
        verbose: Whether to print cleanup messages.

    Returns:
        Number of stale files removed.
    """
    if not state.db_path.exists():
        return 0

    stale_set = TEMPLATE_OUTPUT_FILES - expected_filenames
    if not stale_set:
        return 0

    removed_count = 0
    for schema_name in state.synced_schemas:
        schema_path = state.db_path / f"schema={schema_name}"
        if not schema_path.exists():
            continue
        for table_name in state.synced_tables.get(schema_name, set()):
            table_path = schema_path / f"table={table_name}"
            if not table_path.exists():
                continue
            for file_path in table_path.iterdir():
                if not file_path.is_file():
                    continue
                if file_path.name in stale_set:
                    file_path.unlink()
                    removed_count += 1
                    if verbose:
                        console.print(
                            f"  [dim red]removing stale template file:[/dim red] "
                            f"{schema_name}.{table_name}/{file_path.name}"
                        )

    return removed_count
