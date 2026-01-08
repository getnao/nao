import sys
from pathlib import Path

from ibis import BaseBackend
from rich.console import Console
from rich.progress import BarColumn, Progress, SpinnerColumn, TaskProgressColumn, TextColumn

from nao_core.config import NaoConfig

console = Console()


def get_table_schema_markdown(conn: BaseBackend, dataset: str, table: str) -> str:
    """Generate markdown content describing a table's columns."""
    try:
        # Get the table reference and its schema
        full_table_name = f"{dataset}.{table}"
        t = conn.table(full_table_name)
        schema = t.schema()

        lines = [
            f"# {table}",
            "",
            f"**Dataset:** `{dataset}`",
            "",
            "## Columns",
            "",
            "| Column | Type | Nullable |",
            "|--------|------|----------|",
        ]

        for name, dtype in schema.items():
            nullable = "Yes" if dtype.nullable else "No"
            lines.append(f"| `{name}` | `{dtype}` | {nullable} |")

        return "\n".join(lines)
    except Exception as e:
        return f"# {table}\n\nError fetching schema: {e}"


def sync_bigquery(db_config, base_path: Path, progress: Progress) -> tuple[int, int]:
    """Sync BigQuery database schema to markdown files.

    Returns:
            Tuple of (datasets_synced, tables_synced)
    """
    conn = db_config.connect()
    db_path = base_path / "bigquery" / db_config.name

    datasets_synced = 0
    tables_synced = 0

    # Get datasets to sync
    if db_config.dataset_id:
        datasets = [db_config.dataset_id]
    else:
        datasets = conn.list_databases()

    dataset_task = progress.add_task(
        f"[dim]{db_config.name}[/dim]",
        total=len(datasets),
    )

    for dataset in datasets:
        dataset_path = db_path / dataset
        dataset_path.mkdir(parents=True, exist_ok=True)
        datasets_synced += 1

        # List tables in this dataset
        try:
            tables = conn.list_tables(database=dataset)
        except Exception:
            progress.update(dataset_task, advance=1)
            continue

        table_task = progress.add_task(
            f"  [cyan]{dataset}[/cyan]",
            total=len(tables),
        )

        for table in tables:
            table_path = dataset_path / table
            table_path.mkdir(parents=True, exist_ok=True)

            columns_md = get_table_schema_markdown(conn, dataset, table)
            columns_file = table_path / "columns.md"
            columns_file.write_text(columns_md)
            tables_synced += 1

            progress.update(table_task, advance=1)

        progress.update(dataset_task, advance=1)

    return datasets_synced, tables_synced


def sync(output_dir: str = "databases"):
    """Sync database schemas to local markdown files.

    Creates a folder structure with table schemas:
      databases/bigquery/<connection>/<dataset>/<table>/columns.md

    Args:
            output_dir: Output directory for the database schemas (default: "databases")
    """
    console.print("\n[bold cyan]🔄 nao sync[/bold cyan]\n")

    # Load config
    config = NaoConfig.try_load()
    if not config:
        console.print("[bold red]✗[/bold red] No nao_config.yaml found in current directory")
        console.print("[dim]Run 'nao init' to create a configuration file[/dim]")
        sys.exit(1)

    console.print(f"[dim]Project:[/dim] {config.project_name}")

    if not config.databases:
        console.print("[dim]No databases configured[/dim]")
        return

    base_path = Path(output_dir)
    total_datasets = 0
    total_tables = 0

    console.print()

    with Progress(
        SpinnerColumn(style="dim"),
        TextColumn("[progress.description]{task.description}"),
        BarColumn(bar_width=30, style="dim", complete_style="cyan", finished_style="green"),
        TaskProgressColumn(),
        console=console,
        transient=False,
    ) as progress:
        for db in config.databases:
            try:
                if db.type == "bigquery":
                    datasets, tables = sync_bigquery(db, base_path, progress)
                    total_datasets += datasets
                    total_tables += tables
                else:
                    console.print(f"[yellow]⚠ Unsupported database type: {db.type}[/yellow]")
            except Exception as e:
                console.print(f"[bold red]✗[/bold red] Failed to sync {db.name}: {e}")

    console.print()
    console.print(
        f"[green]✓[/green] Synced [bold]{total_tables}[/bold] tables across [bold]{total_datasets}[/bold] datasets"
    )
    console.print(f"[dim]  → {base_path.absolute()}[/dim]")
    console.print()
