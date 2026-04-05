"""Sync logic for Power BI Semantic Model via XMLA.

Generates markdown context files (columns, measures, relations) under:
  {base_path}/type=powerbi_xmla/database={dataset}/schema={dataset}/table={table}/columns.md
  {base_path}/type=powerbi_xmla/database={dataset}/schema={dataset}/measures.md
  {base_path}/type=powerbi_xmla/database={dataset}/schema={dataset}/relations.md
"""

from __future__ import annotations

import time
from pathlib import Path
from typing import TYPE_CHECKING

from nao_core.commands.sync.cleanup import DatabaseSyncState

if TYPE_CHECKING:
    from rich.progress import Progress
    from nao_core.config.databases.powerbi_xmla import PowerBIXmlaConfig


_DAX_TYPE_MAP = {
    "2": "string",
    "6": "int64",
    "8": "double",
    "9": "datetime",
    "10": "currency",
    "11": "boolean",
}

_CARDINALITY_MAP = {
    "1": "OneToOne",
    "2": "ManyToOne",
    "3": "OneToMany",
}


def _dax_type_label(data_type: str | None) -> str:
    return _DAX_TYPE_MAP.get(data_type or "", f"type({data_type})")


def _cardinality_label(code: str | None) -> str:
    return _CARDINALITY_MAP.get(code or "", code or "?")


def _render_columns_md(table_name: str, columns: list[dict], dataset: str) -> str:
    lines = [
        f"# {table_name}",
        "",
        f"**Dataset:** {dataset} (Power BI Semantic Model)",
        "",
        "## Columns",
        "",
        "| Column | Type | Description |",
        "|--------|------|-------------|",
    ]
    for col in columns:
        name = col.get("Name") or col.get("ExplicitName") or "?"
        dtype = _dax_type_label(col.get("DataType") or col.get("ExplicitDataType"))
        desc = (col.get("Description") or "").replace("|", "\\|")
        lines.append(f"| {name} | {dtype} | {desc} |")
    return "\n".join(lines) + "\n"


def _resolve_table_name(raw_id: str | None, table_name_by_id: dict[str, str]) -> str:
    """Resolve a numeric table ID to a human-readable name using the provided mapping."""
    if not raw_id:
        return "?"
    return table_name_by_id.get(raw_id, raw_id)


def _render_measures_md(measures: list[dict], dataset: str, table_name_by_id: dict[str, str]) -> str:
    if not measures:
        return f"# Measures — {dataset}\n\nNo measures defined.\n"

    lines = [
        f"# Measures — {dataset}",
        "",
        "| Measure | Table | Expression (truncated to 120 chars) |",
        "|---------|-------|--------------------------------------|",
    ]
    for m in measures:
        name = m.get("Name") or "?"
        raw_table = m.get("TableID") or m.get("TableName")
        table = _resolve_table_name(raw_table, table_name_by_id)
        expr = (m.get("Expression") or "").replace("\n", " ").replace("|", "\\|")
        expr = expr[:120] + ("…" if len(expr) > 120 else "")
        lines.append(f"| {name} | {table} | `{expr}` |")
    return "\n".join(lines) + "\n"


def _render_relations_md(relations: list[dict], dataset: str, table_name_by_id: dict[str, str]) -> str:
    if not relations:
        return f"# Relationships — {dataset}\n\nNo relationships defined.\n"

    lines = [
        f"# Relationships — {dataset}",
        "",
        "| From Table | From Column | To Table | To Column | Cardinality | Active |",
        "|------------|-------------|----------|-----------|-------------|--------|",
    ]
    for r in relations:
        from_table = _resolve_table_name(r.get("FromTableID") or r.get("FromTableName"), table_name_by_id)
        from_col = r.get("FromColumnID") or r.get("FromColumnName") or "?"
        to_table = _resolve_table_name(r.get("ToTableID") or r.get("ToTableName"), table_name_by_id)
        to_col = r.get("ToColumnID") or r.get("ToColumnName") or "?"
        card = _cardinality_label(r.get("FromCardinality") or r.get("Cardinality"))
        active = "Yes" if (r.get("IsActive") or "true").lower() == "true" else "No"
        lines.append(f"| {from_table} | {from_col} | {to_table} | {to_col} | {card} | {active} |")
    return "\n".join(lines) + "\n"


def sync_powerbi_xmla(
    db_config: "PowerBIXmlaConfig",
    base_path: Path,
    progress: "Progress",
    db_folder: str | None = None,
) -> DatabaseSyncState:
    """Sync a Power BI Semantic Model to context markdown files."""
    from rich.console import Console

    from nao_core.commands.sync.providers.databases.powerbi_xmla.client import XmlaClient

    console = Console()

    if db_folder is None:
        db_folder = f"database={db_config.get_database_name()}"

    db_path = base_path / f"type={db_config.type}" / db_folder
    dataset = db_config.dataset
    state = DatabaseSyncState(db_path=db_path)

    t0 = time.monotonic()
    console.print(f"  [dim]Connecting to[/dim] [bold]{db_config.name}[/bold] [dim](XMLA)[/dim]")

    client = XmlaClient(db_config)

    # --- Discover metadata ---
    tables = client.discover_tables()
    all_columns = client.discover_columns()
    measures = client.discover_measures()
    relations = client.discover_relationships()

    console.print(
        f"  [dim]Found[/dim] [bold]{len(tables)}[/bold] tables, "
        f"[bold]{len(measures)}[/bold] measures, "
        f"[bold]{len(relations)}[/bold] relationships"
    )

    schema_path = db_path / f"schema={dataset}"
    schema_path.mkdir(parents=True, exist_ok=True)
    state.add_schema(dataset)

    # Build ID → Name mapping for measures/relations resolution.
    # TMSCHEMA_TABLES uses "ID" for its own primary key; "TableID" is a foreign-key field
    # used in cross-reference DMVs (TMSCHEMA_COLUMNS, TMSCHEMA_MEASURES, etc.).
    table_name_by_id: dict[str, str] = {}
    for t in tables:
        tid = t.get("ID")
        tname = t.get("Name")
        if tid and tname:
            table_name_by_id[tid] = tname
        if tname:
            table_name_by_id[tname] = tname  # name → name fallback for DMVs that emit names

    # Group columns by the foreign-key TableID they report.
    cols_by_table: dict[str, list[dict]] = {}
    for col in all_columns:
        table_id = col.get("TableID") or col.get("TableName") or "unknown"
        cols_by_table.setdefault(table_id, []).append(col)

    # Warn if any columns cannot be attributed to a known table (signals a join gap).
    known_table_ids = set(table_name_by_id.keys())
    orphaned_ids = set(cols_by_table.keys()) - known_table_ids - {"unknown"}
    if orphaned_ids:
        console.print(
            f"  [yellow]⚠ {len(orphaned_ids)} column group(s) could not be matched to a table "
            f"(TableID: {', '.join(sorted(orphaned_ids)[:5])}). "
            "Set xmla_endpoint explicitly if this persists.[/yellow]"
        )

    task = progress.add_task(f"[dim]{db_config.name}[/dim]", total=len(tables))

    for table in tables:
        table_name = table.get("Name") or "unknown"
        # Use "ID" — the table's own primary key in TMSCHEMA_TABLES — to look up columns
        # that reference it via their "TableID" foreign-key field.
        table_id = table.get("ID") or table_name

        table_path = schema_path / f"table={table_name}"
        table_path.mkdir(parents=True, exist_ok=True)

        progress.update(task, description=f"  [cyan]{dataset}[/cyan] [dim]→ {table_name}[/dim]")

        table_cols = cols_by_table.get(table_id, [])
        content = _render_columns_md(table_name, table_cols, dataset)
        (table_path / "columns.md").write_text(content)

        state.add_table(dataset, table_name)
        progress.update(task, advance=1)

    # --- Dataset-level files ---
    (schema_path / "measures.md").write_text(_render_measures_md(measures, dataset, table_name_by_id))
    (schema_path / "relations.md").write_text(_render_relations_md(relations, dataset, table_name_by_id))

    elapsed = f"{time.monotonic() - t0:.1f}s"
    console.print(
        f"  [green]✓ {dataset}[/green] [dim]— {len(tables)} tables synced in {elapsed}[/dim]"
    )

    return state
