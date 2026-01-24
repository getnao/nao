"""Database syncing functionality for generating markdown documentation from database schemas."""

from pathlib import Path

from rich.console import Console
from rich.progress import BarColumn, Progress, SpinnerColumn, TaskProgressColumn, TextColumn

from nao_core.commands.sync.registry import get_accessors

from .bigquery import sync_bigquery
from .databricks import sync_databricks
from .duckdb import sync_duckdb
from .postgres import sync_postgres
from .snowflake import sync_snowflake

console = Console()


def sync_databases(databases: list, base_path: Path) -> tuple[int, int]:
    """Sync all configured databases.

    Args:
            databases: List of database configurations
            base_path: Base path where database schemas are stored

    Returns:
            Tuple of (total_datasets, total_tables) synced
    """
    if not databases:
        console.print("\n[dim]No databases configured[/dim]")
        return 0, 0

    total_datasets = 0
    total_tables = 0

    console.print("\n[bold cyan]🗄️  Syncing Databases[/bold cyan]")
    console.print(f"[dim]Location:[/dim] {base_path.absolute()}\n")

    with Progress(
        SpinnerColumn(style="dim"),
        TextColumn("[progress.description]{task.description}"),
        BarColumn(bar_width=30, style="dim", complete_style="cyan", finished_style="green"),
        TaskProgressColumn(),
        console=console,
        transient=False,
    ) as progress:
        for db in databases:
            # Get accessors from database config
            db_accessors = get_accessors(db.accessors)
            accessor_names = [a.filename.replace(".md", "") for a in db_accessors]

            try:
                console.print(f"[dim]{db.name} accessors:[/dim] {', '.join(accessor_names)}")
                if db.type == "bigquery":
                    datasets, tables = sync_bigquery(db, base_path, progress, db_accessors)
                    total_datasets += datasets
                    total_tables += tables
                elif db.type == "duckdb":
                    schemas, tables = sync_duckdb(db, base_path, progress, db_accessors)
                    total_datasets += schemas
                    total_tables += tables
                elif db.type == "databricks":
                    console.print(f"[dim]{db.name} accessors:[/dim] {', '.join(accessor_names)}")
                    schemas, tables = sync_databricks(db, base_path, progress, db_accessors)
                    total_datasets += schemas
                    total_tables += tables
                elif db.type == "snowflake":
                    console.print(f"[dim]{db.name} accessors:[/dim] {', '.join(accessor_names)}")
                    schemas, tables = sync_snowflake(db, base_path, progress, db_accessors)
                    total_datasets += schemas
                    total_tables += tables
                elif db.type == "postgres":
                    console.print(f"[dim]{db.name} accessors:[/dim] {', '.join(accessor_names)}")
                    schemas, tables = sync_postgres(db, base_path, progress, db_accessors)
                    total_datasets += schemas
                    total_tables += tables
                else:
                    console.print(f"[yellow]⚠ Unsupported database type: {db.type}[/yellow]")
            except Exception as e:
                console.print(f"[bold red]✗[/bold red] Failed to sync {db.name}: {e}")

    return total_datasets, total_tables
