"""Database syncing functionality for generating markdown documentation from database schemas."""

from pathlib import Path

from rich.console import Console
from rich.progress import BarColumn, Progress, SpinnerColumn, TaskProgressColumn, TextColumn

from .accessors import DataAccessor
from .registry import get_accessors

console = Console()


def sync_bigquery(
    db_config,
    base_path: Path,
    progress: Progress,
    accessors: list[DataAccessor],
) -> tuple[int, int]:
    """Sync BigQuery database schema to markdown files.

    Args:
            db_config: The database configuration
            base_path: Base output path
            progress: Rich progress instance
            accessors: List of data accessors to run

    Returns:
            Tuple of (datasets_synced, tables_synced)
    """
    conn = db_config.connect()
    db_path = base_path / "bigquery" / db_config.name

    datasets_synced = 0
    tables_synced = 0

    if db_config.dataset_id:
        datasets = [db_config.dataset_id]
    else:
        datasets = conn.list_databases()

    dataset_task = progress.add_task(
        f"[dim]{db_config.name}[/dim]",
        total=len(datasets),
    )

    for dataset in datasets:
        try:
            all_tables = conn.list_tables(database=dataset)
        except Exception:
            progress.update(dataset_task, advance=1)
            continue

        # Filter tables based on include/exclude patterns
        tables = [t for t in all_tables if db_config.matches_pattern(dataset, t)]

        # Skip dataset if no tables match
        if not tables:
            progress.update(dataset_task, advance=1)
            continue

        dataset_path = db_path / dataset
        dataset_path.mkdir(parents=True, exist_ok=True)
        datasets_synced += 1

        table_task = progress.add_task(
            f"  [cyan]{dataset}[/cyan]",
            total=len(tables),
        )

        for table in tables:
            table_path = dataset_path / table
            table_path.mkdir(parents=True, exist_ok=True)

            for accessor in accessors:
                content = accessor.generate(conn, dataset, table)
                output_file = table_path / accessor.filename
                output_file.write_text(content)

            tables_synced += 1
            progress.update(table_task, advance=1)

        progress.update(dataset_task, advance=1)

    return datasets_synced, tables_synced


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
                if db.type == "bigquery":
                    console.print(f"[dim]{db.name} accessors:[/dim] {', '.join(accessor_names)}")
                    datasets, tables = sync_bigquery(db, base_path, progress, db_accessors)
                    total_datasets += datasets
                    total_tables += tables
                else:
                    console.print(f"[yellow]⚠ Unsupported database type: {db.type}[/yellow]")
            except Exception as e:
                console.print(f"[bold red]✗[/bold red] Failed to sync {db.name}: {e}")

    return total_datasets, total_tables
