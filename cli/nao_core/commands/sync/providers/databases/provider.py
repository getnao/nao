"""Database sync provider implementation."""

import time
from pathlib import Path
from typing import Any

from rich.console import Console
from rich.progress import (
    BarColumn,
    MofNCompleteColumn,
    Progress,
    SpinnerColumn,
    TaskProgressColumn,
    TextColumn,
    TimeElapsedColumn,
)

from nao_core.commands.sync.cleanup import DatabaseSyncState, cleanup_stale_databases, cleanup_stale_paths
from nao_core.config import AnyDatabaseConfig, NaoConfig
from nao_core.config.databases.base import DatabaseConfig
from nao_core.templates.engine import get_template_engine

from ..base import SyncProvider, SyncResult
from .context import DatabaseContext

console = Console()

TEMPLATE_PREFIX = "databases"


def _filter_templates_by_accessor(templates: list[str], db_config: DatabaseConfig) -> list[str]:
    """Keep only templates whose stem matches the configured accessors."""
    allowed = {a.value for a in db_config.accessors}
    return [t for t in templates if Path(t).stem.replace(".md", "") in allowed]


def _fmt_duration(seconds: float) -> str:
    """Format seconds into a human-readable duration."""
    if seconds < 1:
        return f"{seconds * 1000:.0f}ms"
    if seconds < 60:
        return f"{seconds:.1f}s"
    minutes = int(seconds // 60)
    secs = seconds % 60
    return f"{minutes}m{secs:.0f}s"


def sync_database(
    db_config: DatabaseConfig,
    base_path: Path,
    progress: Progress,
    project_path: Path | None = None,
) -> DatabaseSyncState:
    """Sync a single database by rendering all database templates for each table."""
    engine = get_template_engine(project_path)
    templates = _filter_templates_by_accessor(engine.list_templates(TEMPLATE_PREFIX), db_config)

    t_connect = time.monotonic()
    conn = db_config.connect()
    console.print(
        f"  [dim]Connected to[/dim] [bold]{db_config.name}[/bold] "
        f"[dim]({_fmt_duration(time.monotonic() - t_connect)})[/dim]"
    )

    db_name = db_config.get_database_name()
    db_path = base_path / f"type={db_config.type}" / f"database={db_name}"
    state = DatabaseSyncState(db_path=db_path)

    t_schemas = time.monotonic()
    schemas = db_config.get_schemas(conn)
    console.print(
        f"  [dim]Found[/dim] [bold]{len(schemas)}[/bold] "
        f"[dim]schemas ({_fmt_duration(time.monotonic() - t_schemas)})[/dim]"
    )

    schema_task = progress.add_task(
        f"[dim]{db_config.name}[/dim]",
        total=len(schemas),
    )

    total_errors = 0

    for schema in schemas:
        try:
            t_list = time.monotonic()
            all_tables = conn.list_tables(database=schema)
        except Exception as e:
            console.print(f"  [yellow]⚠[/yellow] [dim]Skipping schema[/dim] {schema}: {e}")
            progress.update(schema_task, advance=1)
            continue

        tables = [t for t in all_tables if db_config.matches_pattern(schema, t)]

        if not tables:
            progress.update(schema_task, advance=1)
            continue

        list_dur = _fmt_duration(time.monotonic() - t_list)
        console.print(
            f"  [cyan]▸ {schema}[/cyan] [dim]— {len(tables)} tables "
            f"(of {len(all_tables)} total, listed in {list_dur})[/dim]"
        )

        schema_path = db_path / f"schema={schema}"
        schema_path.mkdir(parents=True, exist_ok=True)
        state.add_schema(schema)

        table_task = progress.add_task(
            f"    [cyan]{schema}[/cyan]",
            total=len(tables),
        )

        schema_errors = 0
        schema_start = time.monotonic()

        for table in tables:
            table_path = schema_path / f"table={table}"
            table_path.mkdir(parents=True, exist_ok=True)

            progress.update(
                table_task,
                description=f"    [cyan]{schema}[/cyan] [dim]→ {table}[/dim]",
            )

            create_context = getattr(db_config, "create_context", None)
            if create_context and callable(create_context):
                ctx = create_context(conn, schema, table)
            else:
                table_desc = db_config.fetch_table_description(conn, schema, table)
                col_descs = db_config.fetch_column_descriptions(conn, schema, table)
                ctx = DatabaseContext(
                    conn,
                    schema,
                    table,
                    table_description=table_desc,
                    column_descriptions=col_descs,
                )

            for template_name in templates:
                output_filename = Path(template_name).stem
                accessor_name = output_filename.replace(".md", "")

                t_render = time.monotonic()
                try:
                    content = engine.render(template_name, db=ctx, table_name=table, dataset=schema)
                    render_dur = time.monotonic() - t_render
                    if render_dur > 5:
                        console.print(
                            f"    [yellow]⏱[/yellow] [dim]{schema}.{table}[/dim] "
                            f"[yellow]{accessor_name}[/yellow] [dim]took {_fmt_duration(render_dur)}[/dim]"
                        )
                except Exception as e:
                    render_dur = time.monotonic() - t_render
                    schema_errors += 1
                    total_errors += 1
                    console.print(
                        f"    [bold red]✗[/bold red] [dim]{schema}.{table}[/dim] "
                        f"[red]{accessor_name}[/red] [dim]failed after "
                        f"{_fmt_duration(render_dur)}:[/dim] {e}"
                    )
                    content = f"# {table}\n\nError generating content: {e}"

                output_file = table_path / output_filename
                output_file.write_text(content)

            state.add_table(schema, table)
            progress.update(table_task, advance=1)

        progress.update(
            table_task,
            description=f"    [cyan]{schema}[/cyan]",
        )
        schema_dur = _fmt_duration(time.monotonic() - schema_start)
        error_suffix = f" [red]({schema_errors} errors)[/red]" if schema_errors else ""
        console.print(
            f"  [green]✓ {schema}[/green] [dim]— {len(tables)} tables synced in {schema_dur}{error_suffix}[/dim]"
        )

        progress.update(schema_task, advance=1)

    if total_errors:
        console.print(f"  [yellow]⚠ {total_errors} total errors during sync[/yellow]")

    return state


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
        cleanup_stale_databases(config.databases, output_path, verbose=True)

    def get_items(self, config: NaoConfig) -> list[AnyDatabaseConfig]:
        return config.databases

    def sync(self, items: list[Any], output_path: Path, project_path: Path | None = None) -> SyncResult:
        if not items:
            console.print("\n[dim]No databases configured[/dim]")
            return SyncResult(provider_name=self.name, items_synced=0)

        total_datasets = 0
        total_tables = 0
        total_removed = 0
        sync_states: list[DatabaseSyncState] = []

        console.print(f"\n[bold cyan]{self.emoji}  Syncing {self.name}[/bold cyan]")
        console.print(f"[dim]Location:[/dim] {output_path.absolute()}")

        for db in items:
            accessor_names = [a.value for a in db.accessors]
            console.print(f"[dim]{db.name}:[/dim] {', '.join(accessor_names)}")
        console.print()

        sync_start = time.monotonic()

        with Progress(
            SpinnerColumn(style="dim"),
            TextColumn("[progress.description]{task.description}"),
            BarColumn(bar_width=30, style="dim", complete_style="cyan", finished_style="green"),
            MofNCompleteColumn(),
            TaskProgressColumn(),
            TimeElapsedColumn(),
            console=console,
            transient=False,
        ) as progress:
            for db in items:
                try:
                    state = sync_database(db, output_path, progress, project_path)
                    sync_states.append(state)
                    total_datasets += state.schemas_synced
                    total_tables += state.tables_synced
                except Exception as e:
                    console.print(f"[bold red]✗[/bold red] Failed to sync {db.name}: {e}")

        for state in sync_states:
            removed = cleanup_stale_paths(state, verbose=True)
            total_removed += removed

        total_dur = _fmt_duration(time.monotonic() - sync_start)
        summary = f"{total_tables} tables across {total_datasets} datasets in {total_dur}"
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
