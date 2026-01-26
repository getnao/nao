from pathlib import Path

from rich.progress import Progress

from nao_core.commands.sync.accessors import DataAccessor
from nao_core.commands.sync.cleanup import DatabaseSyncState


def sync_databricks(
    db_config,
    base_path: Path,
    progress: Progress,
    accessors: list[DataAccessor],
) -> DatabaseSyncState:
    """Sync Databricks database schema to markdown files.

    Args:
            db_config: The database configuration
            base_path: Base output path
            progress: Rich progress instance
            accessors: List of data accessors to run

    Returns:
            DatabaseSyncState with sync results and tracked paths
    """
    conn = db_config.connect()
    catalog = db_config.catalog or "main"
    db_path = base_path / "type=databricks" / f"database={catalog}"
    state = DatabaseSyncState(db_path=db_path)

    if db_config.schema:
        schemas = [db_config.schema]
    else:
        schemas = conn.list_databases()

    schema_task = progress.add_task(
        f"[dim]{db_config.name}[/dim]",
        total=len(schemas),
    )

    for schema in schemas:
        try:
            all_tables = conn.list_tables(database=schema)
        except Exception:
            progress.update(schema_task, advance=1)
            continue

        # Filter tables based on include/exclude patterns
        tables = [t for t in all_tables if db_config.matches_pattern(schema, t)]

        # Skip schema if no tables match
        if not tables:
            progress.update(schema_task, advance=1)
            continue

        schema_path = db_path / f"schema={schema}"
        schema_path.mkdir(parents=True, exist_ok=True)
        state.add_schema(schema)

        table_task = progress.add_task(
            f"  [cyan]{schema}[/cyan]",
            total=len(tables),
        )

        for table in tables:
            table_path = schema_path / f"table={table}"
            table_path.mkdir(parents=True, exist_ok=True)

            for accessor in accessors:
                content = accessor.generate(conn, schema, table)
                output_file = table_path / accessor.filename
                output_file.write_text(content)

            state.add_table(schema, table)
            progress.update(table_task, advance=1)

        progress.update(schema_task, advance=1)

    return state
