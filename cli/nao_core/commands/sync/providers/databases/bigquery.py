from pathlib import Path

from rich.progress import Progress

from nao_core.commands.sync.accessors import DataAccessor
from nao_core.commands.sync.cleanup import DatabaseSyncState


def sync_bigquery(
    db_config,
    base_path: Path,
    progress: Progress,
    accessors: list[DataAccessor],
) -> DatabaseSyncState:
    """Sync BigQuery database schema to markdown files.

    Args:
            db_config: The database configuration
            base_path: Base output path
            progress: Rich progress instance
            accessors: List of data accessors to run

    Returns:
            DatabaseSyncState with sync results and tracked paths
    """
    conn = db_config.connect()
    db_path = base_path / "type=bigquery" / f"database={db_config.project_id}"
    state = DatabaseSyncState(db_path=db_path)

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

        dataset_path = db_path / f"schema={dataset}"
        dataset_path.mkdir(parents=True, exist_ok=True)
        state.add_schema(dataset)

        table_task = progress.add_task(
            f"  [cyan]{dataset}[/cyan]",
            total=len(tables),
        )

        for table in tables:
            table_path = dataset_path / f"table={table}"
            table_path.mkdir(parents=True, exist_ok=True)

            for accessor in accessors:
                content = accessor.generate(conn, dataset, table)
                output_file = table_path / accessor.filename
                output_file.write_text(content)

            state.add_table(dataset, table)
            progress.update(table_task, advance=1)

        progress.update(dataset_task, advance=1)

    return state
