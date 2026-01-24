"""Database sync provider implementation."""

from pathlib import Path
from typing import Any

from rich.console import Console
from rich.progress import BarColumn, Progress, SpinnerColumn, TaskProgressColumn, TextColumn

from nao_core.commands.sync.registry import get_accessors
from nao_core.config import AnyDatabaseConfig, NaoConfig

from ..base import SyncProvider, SyncResult
from .bigquery import sync_bigquery
from .databricks import sync_databricks
from .duckdb import sync_duckdb
from .postgres import sync_postgres
from .snowflake import sync_snowflake

console = Console()

# Registry mapping database types to their sync functions
DATABASE_SYNC_FUNCTIONS = {
    "bigquery": sync_bigquery,
    "duckdb": sync_duckdb,
    "databricks": sync_databricks,
    "snowflake": sync_snowflake,
    "postgres": sync_postgres,
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

    def get_items(self, config: NaoConfig) -> list[AnyDatabaseConfig]:
        return config.databases

    def sync(self, items: list[Any], output_path: Path) -> SyncResult:
        """Sync all configured databases.

        Args:
                items: List of database configurations
                output_path: Base path where database schemas are stored

        Returns:
                SyncResult with datasets and tables synced
        """
        if not items:
            console.print("\n[dim]No databases configured[/dim]")
            return SyncResult(provider_name=self.name, items_synced=0)

        total_datasets = 0
        total_tables = 0

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
                        datasets, tables = sync_fn(db, output_path, progress, db_accessors)
                        total_datasets += datasets
                        total_tables += tables
                    else:
                        console.print(f"[yellow]⚠ Unsupported database type: {db.type}[/yellow]")
                except Exception as e:
                    console.print(f"[bold red]✗[/bold red] Failed to sync {db.name}: {e}")

        return SyncResult(
            provider_name=self.name,
            items_synced=total_tables,
            details={"datasets": total_datasets, "tables": total_tables},
            summary=f"{total_tables} tables across {total_datasets} datasets",
        )
