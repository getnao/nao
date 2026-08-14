from __future__ import annotations

import json
from pathlib import Path
from typing import Any

COLUMN_CATALOG_VERSION = 1

Column = dict[str, str]
Tables = dict[str, list[Column]]
Schemas = dict[str, Tables]


def column_catalog_path(project_path: Path, database_type: str, database_folder: str) -> Path:
    return project_path / ".meta" / "databases" / f"type={database_type}" / database_folder / "columns.json"


def load_column_catalog(path: Path) -> Schemas:
    try:
        document = json.loads(path.read_text())
    except (OSError, json.JSONDecodeError):
        return {}
    if not isinstance(document, dict):
        return {}
    if document.get("version") != COLUMN_CATALOG_VERSION:
        return {}
    return _parse_schemas(document.get("schemas"))


def write_column_catalog(path: Path, schemas: Schemas) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary_path = path.with_suffix(f"{path.suffix}.tmp")
    document = {
        "version": COLUMN_CATALOG_VERSION,
        "schemas": schemas,
    }
    temporary_path.write_text(json.dumps(document, indent=2) + "\n")
    temporary_path.replace(path)


def merge_column_catalog(existing: Schemas, synced: Schemas, partial: bool) -> Schemas:
    if not partial:
        return synced
    merged = {
        schema: {table: list(columns) for table, columns in tables.items()} for schema, tables in existing.items()
    }
    for schema, tables in synced.items():
        merged.setdefault(schema, {}).update(tables)
    return merged


def catalog_columns(columns: list[dict[str, Any]]) -> list[Column]:
    return [
        {
            "name": str(column["name"]),
            "type": str(column["type"]),
        }
        for column in columns
        if column.get("name") is not None and column.get("type") is not None
    ]


def _parse_schemas(value: Any) -> Schemas:
    if not isinstance(value, dict):
        return {}
    schemas: Schemas = {}
    for schema, tables in value.items():
        if not isinstance(schema, str) or not isinstance(tables, dict):
            continue
        parsed_tables: Tables = {}
        for table, columns in tables.items():
            if not isinstance(table, str) or not isinstance(columns, list):
                continue
            parsed_columns = [
                {"name": column["name"], "type": column["type"]}
                for column in columns
                if isinstance(column, dict)
                and isinstance(column.get("name"), str)
                and isinstance(column.get("type"), str)
            ]
            parsed_tables[table] = parsed_columns
        schemas[schema] = parsed_tables
    return schemas
