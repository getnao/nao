"""Database sync provider implementation."""

from __future__ import annotations

import fnmatch
import re
import time
from concurrent.futures import Future, ThreadPoolExecutor, wait
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from functools import partial
from pathlib import Path
from typing import TYPE_CHECKING, Any, Callable, Collection

from rich.console import Console
from rich.markup import escape
from rich.progress import (
    BarColumn,
    MofNCompleteColumn,
    Progress,
    SpinnerColumn,
    TaskID,
    TaskProgressColumn,
    TextColumn,
    TimeElapsedColumn,
)

from nao_core.commands.sync.cleanup import (
    DatabaseSyncState,
    cleanup_stale_databases,
    cleanup_stale_paths,
    get_database_folder_names,
)
from nao_core.commands.sync.markers import ensure_annotations_file, with_generated_marker
from nao_core.commands.sync.providers.databases.query_history import TableUsageStats, compute_table_usage
from nao_core.config import AnyDatabaseConfig, NaoConfig
from nao_core.config.databases.base import (
    DatabaseConfig,
    DatabaseTemplate,
    ProfilingRefreshPolicy,
    RefreshConfig,
)
from nao_core.config.databases.column_catalog import (
    catalog_columns,
    column_catalog_path,
    load_column_catalog,
    merge_column_catalog,
    write_column_catalog,
)
from nao_core.config.llm import LLMConfig
from nao_core.templates.context import NaoContext, create_nao_context
from nao_core.templates.engine import TemplateEngine, get_template_engine
from nao_core.ui import UI

from ..base import SyncProvider, SyncResult

if TYPE_CHECKING:
    from ibis import BaseBackend

console = Console()

TEMPLATE_PREFIX = "databases"


def _filter_templates_by_config(templates: list[str], db_config: AnyDatabaseConfig) -> list[str]:
    """Keep only templates whose stem matches the configured templates."""
    allowed = {a.value for a in db_config.templates}
    return [t for t in templates if Path(t).stem.replace(".md", "") in allowed]


def _matches_selection(schema: str, table: str, select: list[str]) -> bool:
    """Check if a schema.table matches any of the `--select` patterns.

    A pattern selects a single table when it matches the full `schema.table`
    name, or a whole schema when it matches every table beneath it (so
    `analytics` selects `analytics.*`). Matching is case-insensitive (database
    identifiers like Snowflake's are returned uppercased) and supports glob
    wildcards, so `staging.dim_*` selects every `dim_*` table in `staging`.

    Use the schema name as it appears in the sync output, including any catalog
    prefix (e.g. `catalog.analytics`) for databases that qualify schemas.
    """
    full_name = f"{schema}.{table}".lower()
    for pattern in select:
        pattern = pattern.lower()
        if fnmatch.fnmatch(full_name, pattern) or fnmatch.fnmatch(full_name, f"{pattern}.*"):
            return True
    return False


def _database_folders_for(items: list[Any], configured_databases: list[Any]) -> list[str]:
    """Resolve folders against every configured database so a filtered sync writes to the same folders."""
    folders = get_database_folder_names(configured_databases)
    return [folders[configured_databases.index(db)] for db in items]


def _fmt_duration(seconds: float) -> str:
    """Format seconds into a human-readable duration."""
    if seconds < 1:
        return f"{seconds * 1000:.0f}ms"
    if seconds < 60:
        return f"{seconds:.1f}s"
    minutes = int(seconds // 60)
    secs = seconds % 60
    return f"{minutes}m{secs:.0f}s"


def _fmt_error(error: Exception) -> str:
    """Escape exception text before passing it through Rich markup rendering."""
    return escape(str(error))


def _placeholder_for_failed_render(
    table: str,
    template_name: str,
    output_file: Path,
    error: Exception,
    log: Callable[[str], None],
) -> str | None:
    """Decide what to write when a template fails: keep a previous file, else a short placeholder.

    The error text is never written as if it were content so the agent does not
    read a provider error as a table summary.
    """
    if output_file.exists():
        log(f"    [dim]↩ keeping previous {output_file.name}[/dim]")
        return None
    reason = str(error).splitlines()[0] if str(error) else error.__class__.__name__
    return f"# {table}\n\n{_failed_render_notice(template_name)} {reason}\n"


def _failed_render_notice(template_name: str) -> str:
    return f"{template_name} not generated:"


def _is_failed_render_placeholder(output_file: Path) -> bool:
    try:
        return _failed_render_notice(output_file.stem) in output_file.read_text()
    except (OSError, UnicodeError):
        return False


def _fetch_query_history(db_config: DatabaseConfig, conn: BaseBackend) -> list[str]:
    """Fetch query history over the already-open sync connection.

    Reusing the sync connection keeps history fetching on the same credentials
    that sync uses for context (important for auth modes where runtime
    execution uses different credentials, e.g. Redshift Azure Entra ID).
    """
    days = db_config.query_history_days or 30
    history_sql = db_config.get_query_history_sql(days)
    if not history_sql:
        UI.print("  [yellow]⚠[/yellow] [dim]Query history not supported for this database type[/dim]")
        return []

    try:
        cursor = conn.raw_sql(history_sql)  # type: ignore[union-attr]
        queries = _extract_query_texts(cursor)
        fetched = len(queries)
        queries = db_config.filter_query_history(queries)
        excluded = fetched - len(queries)
        suffix = f" [dim](excluded {excluded} via query_history_exclude_patterns)[/dim]" if excluded else ""
        UI.print(f"  [dim]Fetched[/dim] [bold]{fetched}[/bold] [dim]queries for history analysis[/dim]{suffix}")
        return queries
    except Exception as e:
        UI.print(f"  [yellow]⚠[/yellow] [dim]Failed to fetch query history:[/dim] {_fmt_error(e)}")
        return []


def _extract_query_texts(cursor: Any) -> list[str]:
    """Extract query_text column values from a backend cursor or result object."""
    df = _cursor_to_dataframe(cursor)
    if df is not None:
        col = "query_text" if "query_text" in df.columns else df.columns[0]
        return df[col].dropna().astype(str).tolist()

    if hasattr(cursor, "result_rows") and hasattr(cursor, "column_names"):
        columns = list(cursor.column_names)
        return _pick_query_texts(columns, cursor.result_rows)

    if hasattr(cursor, "description") and cursor.description is not None and hasattr(cursor, "fetchall"):
        columns = [desc[0] for desc in cursor.description]
        return _pick_query_texts(columns, cursor.fetchall())

    raise TypeError(f"Unsupported raw_sql result type: {type(cursor).__name__}")


def _cursor_to_dataframe(cursor: Any):
    """Return a pandas DataFrame from backends that expose a native converter, else None."""
    if hasattr(cursor, "fetchdf"):
        return cursor.fetchdf()
    if hasattr(cursor, "to_dataframe"):
        return cursor.to_dataframe()
    if hasattr(cursor, "to_pandas"):
        return cursor.to_pandas()
    return None


def _pick_query_texts(columns: list[str], rows: Any) -> list[str]:
    idx = columns.index("query_text") if "query_text" in columns else 0
    return [str(row[idx]) for row in rows if row[idx] is not None]


def _should_refresh(
    output_file: Path,
    refresh_config: RefreshConfig,
) -> bool:
    """Decide whether a template should be refreshed based on its policy."""

    policy = refresh_config.refresh_policy
    if not output_file.exists() or policy == ProfilingRefreshPolicy.ALWAYS:
        return True
    if _is_failed_render_placeholder(output_file):
        return True
    if policy == ProfilingRefreshPolicy.ONCE:
        return False
    if policy == ProfilingRefreshPolicy.INTERVAL:
        try:
            content = output_file.read_text()
            match = re.search(r"\*\*Computed at:\*\*\s*`([^`]+)`", content, re.IGNORECASE)
            if match:
                computed_at_str = match.group(1)
                computed_at = datetime.fromisoformat(computed_at_str)
                if computed_at.tzinfo is None:
                    computed_at = computed_at.replace(tzinfo=timezone.utc)
                age = datetime.now(timezone.utc) - computed_at
                return age > timedelta(days=refresh_config.interval_days)
        except Exception:
            return True

    return True


def _save_column_catalog(
    state: DatabaseSyncState,
    db_config: AnyDatabaseConfig,
    database_folder: str,
    project_path: Path,
    partial: bool,
    preserved_schemas: Collection[str] = (),
    preserved_tables: Collection[tuple[str, str]] = (),
) -> None:
    path = column_catalog_path(project_path, db_config.type, database_folder)
    existing = load_column_catalog(path)
    synced = {
        schema: {table: catalog_columns(columns) for table, columns in tables.items()}
        for schema, tables in state.synced_columns.items()
    }
    write_column_catalog(
        path,
        merge_column_catalog(existing, synced, partial, preserved_schemas, preserved_tables),
    )


TableSubmit = Callable[..., "Future[Any]"]


def sync_database(
    db_config: AnyDatabaseConfig,
    base_path: Path,
    progress: Progress,
    project_path: Path | None = None,
    llm_config: LLMConfig | None = None,
    db_folder: str | None = None,
    nao_ctx: NaoContext | None = None,
    select: list[str] | None = None,
) -> DatabaseSyncState:
    """Sync a single database by rendering all database templates for each table, one table at a time.

    When `select` is provided, only schemas/tables matching the patterns are
    synced (applied on top of the config include/exclude filters).
    """
    job = start_database_sync(db_config, base_path, progress, project_path, llm_config, db_folder, nao_ctx, select)
    return job.finish()


def start_database_sync(
    db_config: AnyDatabaseConfig,
    base_path: Path,
    progress: Progress,
    project_path: Path | None = None,
    llm_config: LLMConfig | None = None,
    db_folder: str | None = None,
    nao_ctx: NaoContext | None = None,
    select: list[str] | None = None,
    submit: TableSubmit | None = None,
) -> DatabaseSyncJob:
    """Connect, list the tables to sync and hand each table to `submit`.

    Without `submit`, tables render inline, one at a time. With a thread pool's
    `submit`, tables render concurrently and `finish()` applies their results in
    table order. Only pass `submit` for databases with `supports_parallel_table_sync`.
    """
    engine = get_template_engine(project_path, llm_config=llm_config)
    templates = _filter_templates_by_config(engine.list_templates(TEMPLATE_PREFIX), db_config)
    if db_folder is None:
        db_folder = get_database_folder_names([db_config])[0]

    t_connect = time.monotonic()
    conn = db_config.connect()
    job = DatabaseSyncJob(
        db_config=db_config,
        conn=conn,
        progress=progress,
        base_path=base_path,
        project_path=project_path,
        db_folder=db_folder,
        select=select,
        renderer=_TableRenderer(db_config, conn, engine, templates, nao_ctx, progress),
        submit=submit,
    )
    try:
        UI.print(
            f"  [dim]Connected to[/dim] [bold]{db_config.name}[/bold] "
            f"[dim]({_fmt_duration(time.monotonic() - t_connect)})[/dim]"
        )
        job.start()
    except BaseException:
        job.close()
        raise
    return job


class DatabaseSyncJob:
    """One database sync: `start()` submits every table, `finish()` applies the results in table order."""

    def __init__(
        self,
        db_config: AnyDatabaseConfig,
        conn: BaseBackend,
        progress: Progress,
        base_path: Path,
        project_path: Path | None,
        db_folder: str,
        select: list[str] | None,
        renderer: _TableRenderer,
        submit: TableSubmit | None,
    ) -> None:
        self.db_config = db_config
        self.conn = conn
        self.progress = progress
        self.project_path = project_path
        self.base_path = base_path
        self.db_folder = db_folder
        self.select = select
        self.renderer = renderer
        self.submit = submit or _run_inline
        self.buffer_output = submit is not None
        self.state = DatabaseSyncState(db_path=base_path / f"type={db_config.type}" / db_folder)
        self.schema_task: TaskID
        self.failed_schemas: set[str] = set()
        self.failed_tables: set[tuple[str, str]] = set()
        self.pending_schemas: list[_SchemaSync] = []
        self.total_errors = 0

    def start(self) -> None:
        db_config, conn, select = self.db_config, self.conn, self.select

        raw_queries: list[str] = []
        has_query_history = DatabaseTemplate.QUERY_HISTORY in db_config.templates
        if has_query_history:
            raw_queries = _fetch_query_history(db_config, conn)

        t_schemas = time.monotonic()
        schemas = db_config.get_schemas(conn)
        UI.print(
            f"  [dim]Found[/dim] [bold]{len(schemas)}[/bold] "
            f"[dim]schemas ({_fmt_duration(time.monotonic() - t_schemas)})[/dim]"
        )
        self.schema_task = self.progress.add_task(f"[dim]{db_config.name}[/dim]", total=len(schemas))

        schema_tables: dict[str, list[str]] = {}
        for schema in schemas:
            try:
                t_list = time.monotonic()
                all_tables = conn.list_tables(database=schema)
            except Exception as e:
                UI.print(f"  [yellow]⚠[/yellow] [dim]Skipping schema[/dim] {schema}: {_fmt_error(e)}")
                self.failed_schemas.add(schema)
                self.progress.update(self.schema_task, advance=1)
                continue

            tables = [
                t
                for t in all_tables
                if db_config.matches_pattern(schema, t) and (not select or _matches_selection(schema, t, select))
            ]

            if tables:
                list_dur = _fmt_duration(time.monotonic() - t_list)
                UI.print(
                    f"  [cyan]▸ {schema}[/cyan] [dim]— {len(tables)} tables "
                    f"(of {len(all_tables)} total, listed in {list_dur})[/dim]"
                )
            schema_tables[schema] = tables

        selected_tables = [(schema, t) for schema, tables in schema_tables.items() for t in tables]

        usage_stats: dict[str, TableUsageStats] = {}
        if has_query_history and raw_queries and selected_tables:
            dialect = db_config.type if db_config.type != "duckdb" else None
            usage_stats = compute_table_usage(raw_queries, selected_tables, dialect=dialect)

        for schema, tables in schema_tables.items():
            self._submit_schema(schema, tables, usage_stats)

    def finish(self) -> DatabaseSyncState:
        try:
            for schema_sync in self.pending_schemas:
                self._finish_schema(schema_sync)
            self.pending_schemas.clear()

            if self.total_errors:
                self.state.render_errors = self.total_errors
                UI.print(f"  [yellow]⚠ {self.total_errors} total errors during sync[/yellow]")

            catalog_project_path = self.project_path if self.project_path is not None else self.base_path.parent
            _save_column_catalog(
                self.state,
                self.db_config,
                self.db_folder,
                catalog_project_path,
                partial=bool(self.select),
                preserved_schemas=self.failed_schemas,
                preserved_tables=self.failed_tables,
            )
            return self.state
        finally:
            self.close()

    def close(self) -> None:
        """Cancel tables that have not started, wait for the running ones, then disconnect."""
        futures = [pending.future for schema_sync in self.pending_schemas for pending in schema_sync.tables]
        for future in futures:
            future.cancel()
        wait(futures)
        self.conn.disconnect()

    def _submit_schema(self, schema: str, tables: list[str], usage_stats: dict[str, TableUsageStats]) -> None:
        db_config, select = self.db_config, self.select
        semantic_views = db_config.get_semantic_views(self.conn, schema)
        semantic_views = [
            sv
            for sv in semantic_views
            if db_config.matches_pattern(schema, sv["name"])
            and (not select or _matches_selection(schema, sv["name"], select))
        ]

        if not tables and not semantic_views:
            self.progress.update(self.schema_task, advance=1)
            return

        schema_path = self.state.db_path / f"schema={schema}"
        schema_path.mkdir(parents=True, exist_ok=True)

        self.state.add_schema(schema)
        schema_sync = _SchemaSync(
            schema=schema,
            schema_path=schema_path,
            semantic_views=semantic_views,
            table_task=self.progress.add_task(f"    [cyan]{schema}[/cyan]", total=len(tables)),
            start=time.monotonic(),
        )
        self.pending_schemas.append(schema_sync)

        for table in tables:
            messages: list[str] = []
            future = self.submit(
                self.renderer.render,
                schema,
                table,
                schema_path / f"table={table}",
                schema_sync.table_task,
                usage_stats.get(f"{schema}.{table}", TableUsageStats()),
                messages.append if self.buffer_output else UI.print,
            )
            schema_sync.tables.append(_PendingTable(table, future, messages))

        if not self.buffer_output:
            self._finish_schema(self.pending_schemas.pop())

    def _finish_schema(self, schema_sync: _SchemaSync) -> None:
        """Apply the rendered tables of a schema in table order."""
        schema = schema_sync.schema
        schema_errors = 0
        for pending in schema_sync.tables:
            rendered = pending.future.result()
            for message in pending.messages:
                UI.print(message)
            schema_errors += rendered.errors
            if rendered.columns is None:
                self.failed_tables.add((schema, pending.name))
            self.state.add_table(schema, pending.name, rendered.columns)
        self.total_errors += schema_errors

        self.progress.update(
            schema_sync.table_task,
            description=f"    [cyan]{schema}[/cyan]",
        )
        if schema_sync.tables:
            schema_dur = _fmt_duration(time.monotonic() - schema_sync.start)
            error_suffix = f" [red]({schema_errors} errors)[/red]" if schema_errors else ""
            UI.print(
                f"  [green]✓ {schema}[/green] [dim]— {len(schema_sync.tables)} tables synced "
                f"in {schema_dur}{error_suffix}[/dim]"
            )

        if schema_sync.semantic_views:
            _write_semantic_views(schema_sync, self.state)

        self.progress.update(self.schema_task, advance=1)


@dataclass
class _RenderedTable:
    columns: list[dict[str, Any]] | None
    errors: int


@dataclass
class _PendingTable:
    name: str
    future: Future[_RenderedTable]
    messages: list[str]


@dataclass
class _SchemaSync:
    schema: str
    schema_path: Path
    semantic_views: list[dict[str, str]]
    table_task: TaskID
    start: float
    tables: list[_PendingTable] = field(default_factory=list)


@dataclass(frozen=True)
class _TableRenderer:
    """Renders every configured template for one table; safe to call from worker threads."""

    db_config: AnyDatabaseConfig
    conn: BaseBackend
    engine: TemplateEngine
    templates: list[str]
    nao_ctx: NaoContext | None
    progress: Progress

    def render(
        self,
        schema: str,
        table: str,
        table_path: Path,
        table_task: TaskID,
        table_usage: TableUsageStats,
        log: Callable[[str], None],
    ) -> _RenderedTable:
        db_config = self.db_config
        table_path.mkdir(parents=True, exist_ok=True)
        ensure_annotations_file(table_path)

        self.progress.update(
            table_task,
            description=f"    [cyan]{schema}[/cyan] [dim]→ {table}[/dim]",
        )

        ctx = db_config.create_context(self.conn, schema, table)
        ctx.set_exclude_columns(db_config.exclude_columns)
        ctx.set_preview_max_value_length(db_config.preview_max_value_length)
        has_profiling = DatabaseTemplate.PROFILING in db_config.templates
        has_ai_summary = DatabaseTemplate.AI_SUMMARY in db_config.templates
        profiling_due = has_profiling and _should_refresh(
            table_path / "profiling.md",
            db_config.profiling,
        )
        summary_due = has_ai_summary and _should_refresh(
            table_path / "ai_summary.md",
            db_config.ai_summary,
        )
        profiling_data = ctx.profiling() if profiling_due or summary_due else None

        errors = 0
        for template_name in self.templates:
            output_filename = Path(template_name).stem
            tpl_name = output_filename.replace(".md", "")
            output_file = table_path / output_filename

            extra_ctx: dict[str, Any] = {}
            if tpl_name == "query_history":
                extra_ctx["usage_stats"] = table_usage

            if tpl_name == "profiling":
                if not profiling_due:
                    log(
                        f"    [dim]⏭ {schema}.{table} profiling skipped "
                        f"(policy: {db_config.profiling.refresh_policy.value})[/dim]"
                    )
                    continue
                extra_ctx["profiling"] = profiling_data
            if tpl_name == "ai_summary":
                if not summary_due:
                    log(
                        f"    [dim]⏭ {schema}.{table} ai_summary skipped "
                        f"(policy: {db_config.ai_summary.refresh_policy.value})[/dim]"
                    )
                    continue
                extra_ctx["profiling"] = profiling_data
                extra_ctx["computed_at"] = datetime.now(timezone.utc).isoformat()

            t_render = time.monotonic()
            try:
                content: str | None = self.engine.render(
                    template_name,
                    db=ctx,
                    table_name=table,
                    dataset=schema,
                    **({"nao": self.nao_ctx} if self.nao_ctx else {}),
                    **extra_ctx,
                )
                render_dur = time.monotonic() - t_render
                if render_dur > 5:
                    log(
                        f"    [yellow]⏱[/yellow] [dim]{schema}.{table}[/dim] "
                        f"[yellow]{tpl_name}[/yellow] [dim]took {_fmt_duration(render_dur)}[/dim]"
                    )
            except Exception as e:
                render_dur = time.monotonic() - t_render
                errors += 1
                log(
                    f"    [bold red]✗[/bold red] [dim]{schema}.{table}[/dim] "
                    f"[red]{tpl_name}[/red] [dim]failed after "
                    f"{_fmt_duration(render_dur)}:[/dim] {_fmt_error(e)}"
                )
                content = _placeholder_for_failed_render(table, tpl_name, output_file, e, log)

            if content is not None:
                output_file.write_text(with_generated_marker(content))

        columns = ctx.all_columns()
        self.progress.update(table_task, advance=1)
        return _RenderedTable(columns=columns, errors=errors)


def _run_inline(fn: Callable[..., Any], /, *args: Any, **kwargs: Any) -> Future[Any]:
    future: Future[Any] = Future()
    future.set_result(fn(*args, **kwargs))
    return future


def _write_semantic_views(schema_sync: _SchemaSync, state: DatabaseSyncState) -> None:
    for sv in schema_sync.semantic_views:
        sv_path = schema_sync.schema_path / f"semantic_view={sv['name']}"
        sv_path.mkdir(parents=True, exist_ok=True)
        content_parts = [f"# {sv['name']}\n"]
        content_parts.append(
            "This is a Snowflake **semantic view** — use this to understand the intended way to query and aggregate data.\n"
        )
        if sv.get("comment"):
            content_parts.append(f"{sv['comment']}\n")
        if sv.get("definition"):
            content_parts.append("## Definition\n")
            content_parts.append(f"```sql\n{sv['definition']}\n```\n")
        (sv_path / "definition.md").write_text(with_generated_marker("\n".join(content_parts)))
        state.add_table(schema_sync.schema, sv["name"])
    UI.print(
        f"  [green]✓ {schema_sync.schema}[/green] [dim]— {len(schema_sync.semantic_views)} semantic views synced[/dim]"
    )


def _start_on_pool(executor: ThreadPoolExecutor, db: Any, *args: Any, **kwargs: Any) -> Callable[[], DatabaseSyncState]:
    """Start a database sync on a shared pool and return a function that waits for its state.

    Databases that support it submit one task per table, so one large database
    uses the whole pool. Other databases run as a single task, so their
    connection never serves two tables at once.
    """
    if db.supports_parallel_table_sync is not True:
        return executor.submit(sync_database, db, *args, **kwargs).result
    try:
        job = start_database_sync(db, *args, **kwargs, submit=executor.submit)
    except Exception as error:
        return partial(_raise, error)
    return job.finish


def _raise(error: Exception) -> DatabaseSyncState:
    raise error


class DatabaseSyncProvider(SyncProvider):
    """Provider for syncing database schemas to markdown documentation."""

    def __init__(self) -> None:
        self._nao_config: NaoConfig | None = None

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
        self._nao_config = config
        cleanup_stale_databases(config.databases, output_path, verbose=True)

    def get_items(self, config: NaoConfig) -> list[AnyDatabaseConfig]:
        return config.databases

    def sync(
        self,
        items: list[Any],
        output_path: Path,
        project_path: Path | None = None,
        *,
        threads: int = 1,
        select: list[str] | None = None,
    ) -> SyncResult:
        if not items:
            UI.print("\n[dim]No databases configured[/dim]")
            return SyncResult(provider_name=self.name, items_synced=0)

        total_datasets = 0
        total_tables = 0
        total_removed = 0
        total_render_errors = 0
        sync_states: list[DatabaseSyncState] = []
        failures: list[str] = []

        nao_ctx = create_nao_context(self._nao_config, project_path=project_path) if self._nao_config else None
        llm_config = self._nao_config.llm if self._nao_config else None

        UI.print(f"\n[bold cyan]{self.emoji}  Syncing {self.name}[/bold cyan]")
        UI.print(f"[dim]Location:[/dim] {output_path.absolute()}")

        for db in items:
            template_names = [t.value for t in db.templates]
            UI.print(f"[dim]{escape(db.name)}:[/dim] {', '.join(template_names)}")
        if threads > 1:
            UI.print(f"[dim]Threads:[/dim] {threads}")
        if select:
            UI.print(f"[dim]Select:[/dim] {', '.join(select)} [dim](stale cleanup skipped)[/dim]")
        UI.print()

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
            configured_databases = self._nao_config.databases if self._nao_config else items
            db_folders = _database_folders_for(items, configured_databases)
            sync_args = (output_path, progress, project_path, llm_config)
            sync_kwargs: dict[str, Any] = {"nao_ctx": nao_ctx, "select": select}

            def record(db: Any, run: Callable[[], DatabaseSyncState]) -> None:
                try:
                    sync_states.append(run())
                except Exception as e:
                    error = _fmt_error(e)
                    database_name = escape(db.name)
                    failures.append(f"{database_name}: {error}")
                    UI.print(f"[bold red]✗[/bold red] Failed to sync {database_name}: {error}")

            if threads <= 1:
                for db, db_folder in zip(items, db_folders, strict=False):
                    record(db, partial(sync_database, db, *sync_args, db_folder=db_folder, **sync_kwargs))
            else:
                with ThreadPoolExecutor(max_workers=threads, thread_name_prefix="nao-sync") as executor:
                    finishers = [
                        (db, _start_on_pool(executor, db, *sync_args, db_folder=db_folder, **sync_kwargs))
                        for db, db_folder in zip(items, db_folders, strict=False)
                    ]
                    for db, finish in finishers:
                        record(db, finish)

        for state in sync_states:
            total_datasets += state.schemas_synced
            total_tables += state.tables_synced
            total_render_errors += state.render_errors

        if not select:
            for state in sync_states:
                removed = cleanup_stale_paths(state, verbose=True)
                total_removed += removed

        total_dur = _fmt_duration(time.monotonic() - sync_start)
        summary = f"{total_tables} tables across {total_datasets} datasets in {total_dur}"
        if total_removed > 0:
            summary += f", {total_removed} stale removed"
        if total_render_errors > 0:
            summary += f", {total_render_errors} files not generated"

        error = None
        if failures:
            database_label = "database" if len(failures) == 1 else "databases"
            error = f"Failed to sync {len(failures)} {database_label}: {'; '.join(failures)}"

        return SyncResult(
            provider_name=self.name,
            items_synced=total_tables,
            details={
                "datasets": total_datasets,
                "tables": total_tables,
                "removed": total_removed,
            },
            summary=summary,
            error=error,
        )
