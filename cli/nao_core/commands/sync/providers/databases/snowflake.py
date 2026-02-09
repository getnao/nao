from pathlib import Path

from rich.progress import Progress

from nao_core.commands.sync.accessors import DataAccessor
from nao_core.commands.sync.cleanup import DatabaseSyncState


def sync_snowflake(
    db_config,
    base_path: Path,
    progress: Progress,
    accessors: list[DataAccessor],
) -> DatabaseSyncState:
    """Sync Snowflake database schema to markdown files.

    Args:
            db_config: The database configuration
            base_path: Base output path
            progress: Rich progress instance
            accessors: List of data accessors to run

    Returns:
            DatabaseSyncState with sync results and tracked paths
    """
    conn = db_config.connect()
    db_name = db_config.get_database_name()
    db_path = base_path / "type=snowflake" / f"database={db_name}"
    state = DatabaseSyncState(db_path=db_path)

    if db_config.schema_name:
        schemas = [db_config.schema_name]
    else:
        # For Snowflake, list_databases() returns databases, not schemas
        # We need to query INFORMATION_SCHEMA to get schemas within the connected database
        try:
            # Try to access INFORMATION_SCHEMA.SCHEMATA table
            schemas_table = conn.table("SCHEMATA", database="INFORMATION_SCHEMA")
            schemas_df = schemas_table.select("SCHEMA_NAME").distinct().execute()
            schemas = schemas_df["SCHEMA_NAME"].tolist()
        except Exception:
            # Fallback: try using raw SQL if available
            try:
                schemas_query = f"SELECT DISTINCT SCHEMA_NAME FROM {db_name}.INFORMATION_SCHEMA.SCHEMATA ORDER BY SCHEMA_NAME"
                if hasattr(conn, "sql"):
                    schemas_result = conn.sql(schemas_query).execute()
                    schemas = [row["SCHEMA_NAME"] for row in schemas_result.to_dict("records")]
                else:
                    raise AttributeError("sql method not available")
            except Exception:
                # Fallback: try to get schemas by listing all tables and extracting unique schema names
                try:
                    all_tables = conn.list_tables()
                    # Extract schema names from fully qualified table names (database.schema.table)
                    # or from table names if they include schema info
                    schemas_set = set()
                    for table in all_tables:
                        parts = table.split(".")
                        if len(parts) >= 2:
                            # Format: database.schema.table or schema.table
                            schemas_set.add(parts[-2])
                        else:
                            # Default to PUBLIC schema if no schema in name
                            schemas_set.add("PUBLIC")
                    schemas = sorted(list(schemas_set))
                except Exception:
                    # Last resort: use list_databases() (incorrect but might work in some cases)
                    schemas = conn.list_databases()

    schema_task = progress.add_task(
        f"[dim]{db_config.name}[/dim]",
        total=len(schemas),
    )

    for schema in schemas:
        try:
            # For Snowflake, try listing tables for this schema
            # First try with database parameter (which might be interpreted as schema in Snowflake)
            try:
                all_tables = conn.list_tables(database=schema)
            except Exception:
                # If that fails, list all tables and filter by schema name
                all_tables_raw = conn.list_tables()
                # Filter tables that belong to this schema
                # Table names might be in format: schema.table or database.schema.table
                all_tables = []
                for table in all_tables_raw:
                    parts = table.split(".")
                    if len(parts) == 1:
                        # Single part: assume it's in the current/default schema
                        if schema == "PUBLIC" or schema.lower() == "public":
                            all_tables.append(table)
                    elif len(parts) == 2:
                        # Format: schema.table
                        if parts[0] == schema:
                            all_tables.append(parts[1])
                    elif len(parts) >= 3:
                        # Format: database.schema.table
                        if parts[-2] == schema:
                            all_tables.append(parts[-1])
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
