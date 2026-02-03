"""Database sync provider implementation."""

from pathlib import Path
from typing import Any

from rich.console import Console
from rich.progress import BarColumn, Progress, SpinnerColumn, TaskProgressColumn, TextColumn

from nao_core.commands.sync.accessors import DataAccessor
from nao_core.commands.sync.cleanup import DatabaseSyncState, cleanup_stale_databases, cleanup_stale_paths
from nao_core.commands.sync.registry import get_accessors
from nao_core.config import AnyDatabaseConfig, NaoConfig

from ..base import SyncProvider, SyncResult
from .bigquery import sync_bigquery
from .databricks import sync_databricks
from .duckdb import sync_duckdb
from .postgres import sync_postgres
from .redshift import sync_redshift
from .snowflake import sync_snowflake

console = Console()

# Registry mapping database types to their sync functions
DATABASE_SYNC_FUNCTIONS = {
    "bigquery": sync_bigquery,
    "duckdb": sync_duckdb,
    "databricks": sync_databricks,
    "snowflake": sync_snowflake,
    "postgres": sync_postgres,
    "redshift": sync_redshift,
}


class DatabaseSyncProvider(SyncProvider):
    """Provider for syncing database schemas to markdown documentation."""

    @property
    def name(self) -> str:
        return "Databases"

    @property
    def emoji(self) -> str:
        return "🗄️"

    @property
    def default_output_dir(self) -> str:
        return "databases"

    def pre_sync(self, config: NaoConfig, output_path: Path) -> None:
        """
        Always run before syncing.
        """
        cleanup_stale_databases(config.databases, output_path, verbose=True)

    def get_items(self, config: NaoConfig) -> list[AnyDatabaseConfig]:
        return config.databases

    def sync(self, items: list[Any], output_path: Path, project_path: Path | None = None) -> SyncResult:
        """Sync all configured databases.

        Args:
                items: List of database configurations
                output_path: Base path where database schemas are stored
                project_path: Path to the nao project root (for template resolution)

        Returns:
                SyncResult with datasets and tables synced
        """
        if not items:
            console.print("\n[dim]No databases configured[/dim]")
            return SyncResult(provider_name=self.name, items_synced=0)

        # Set project path for template resolution
        DataAccessor.set_project_path(project_path)

        total_datasets = 0
        total_tables = 0
        total_removed = 0
        sync_states: list[DatabaseSyncState] = []

        console.print(f"\n[bold cyan]{self.emoji}  Syncing {self.name}[/bold cyan]")
        console.print(f"[dim]Location:[/dim] {output_path.absolute()}\n")

        with Progress(
            SpinnerColumn(style="dim"),
            TextColumn("[progress.description]{task.description}"),
            BarColumn(bar_width=30, style="dim", complete_style="cyan", finished_style="green"),
            TaskProgressColumn(),
            console=console,
            transient=False,
        ) as progress:
            for db in items:
                # Get accessors from database config
                db_accessors = get_accessors(db.accessors)
                accessor_names = [a.filename.replace(".md", "") for a in db_accessors]

                try:
                    console.print(f"[dim]{db.name} accessors:[/dim] {', '.join(accessor_names)}")

                    sync_fn = DATABASE_SYNC_FUNCTIONS.get(db.type)
                    if sync_fn:
                        state = sync_fn(db, output_path, progress, db_accessors)
                        sync_states.append(state)
                        total_datasets += state.schemas_synced
                        total_tables += state.tables_synced
                    else:
                        console.print(f"[yellow]⚠ Unsupported database type: {db.type}[/yellow]")
                except Exception as e:
                    console.print(f"[bold red]✗[/bold red] Failed to sync {db.name}: {e}")

        # Clean up stale files after all syncs complete
        for state in sync_states:
            removed = cleanup_stale_paths(state, verbose=True)
            total_removed += removed

        # Build summary
        summary = f"{total_tables} tables across {total_datasets} datasets"
        if total_removed > 0:
            summary += f", {total_removed} stale removed"

        return SyncResult(
            provider_name=self.name,
            items_synced=total_tables,
            details={
                "datasets": total_datasets,
                "tables": total_tables,
                "removed": total_removed,
            },
            summary=summary,
        )
