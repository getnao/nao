from __future__ import annotations

from pathlib import Path
from typing import Any, Protocol

import sqlglot
from sqlglot import exp

from nao_core.commands.sync.cleanup import get_database_folder_names
from nao_core.config.databases.query_guard import (
    SQLGLOT_DIALECTS,
    base_table_expressions,
    load_schemas,
    parse_query,
    resolve_table,
)


class _DatabaseConfigLike(Protocol):
    type: str
    name: str
    allow_listed_only: bool

    def connect(self) -> Any: ...

    def get_database_name(self) -> str: ...

    def get_schemas(self, conn: Any) -> list[str]: ...


class AllowListedOnlyGuardError(ValueError):
    pass


def enforce_allow_listed_only(
    sql: str,
    db_config: _DatabaseConfigLike,
    project_folder: str | Path,
    conn: Any | None = None,
) -> str:
    if not db_config.allow_listed_only:
        return sql

    owns_connection = conn is None
    try:
        dialect = SQLGLOT_DIALECTS.get(db_config.type)
        if dialect is None:
            raise _blocked(f"the database dialect '{db_config.type}' is not supported")

        expression = parse_query(sql, dialect, _blocked)
        table_expressions = base_table_expressions(expression, _blocked)
        if not table_expressions:
            return sql

        allowed_tables = load_allowed_context_tables(project_folder, db_config)
        if conn is None:
            conn = db_config.connect()
        referenced_tables = _resolve_tables(table_expressions, conn, db_config)
        unlisted_tables = _find_unlisted_tables(referenced_tables, allowed_tables)
        if unlisted_tables:
            raise AllowListedOnlyGuardError(_unlisted_message(unlisted_tables, allowed_tables))
        return sql
    except AllowListedOnlyGuardError:
        raise
    except Exception as error:
        raise _blocked(str(error)) from error
    finally:
        if owns_connection and conn is not None:
            conn.disconnect()


def query_references_base_tables(sql: str, database_type: str) -> bool:
    dialect = SQLGLOT_DIALECTS.get(database_type)
    if dialect is None:
        return True

    try:
        statements = sqlglot.parse(sql, read=dialect)
        if len(statements) != 1 or not isinstance(statements[0], exp.Query):
            return True
        return bool(base_table_expressions(statements[0], _blocked))
    except Exception:
        return True


def load_allowed_context_tables(
    project_folder: str | Path,
    db_config: _DatabaseConfigLike,
) -> set[str]:
    database_folder = get_database_folder_names([db_config])[0]
    database_path = Path(project_folder) / "databases" / f"type={db_config.type}" / database_folder
    if not database_path.is_dir():
        return set()

    allowed_tables: set[str] = set()
    for schema_path in database_path.iterdir():
        if not schema_path.is_dir() or not schema_path.name.startswith("schema="):
            continue
        schema = schema_path.name.removeprefix("schema=")
        for table_path in schema_path.iterdir():
            if not table_path.is_dir() or not table_path.name.startswith("table="):
                continue
            table = table_path.name.removeprefix("table=")
            allowed_tables.add(f"{schema}.{table}")
    return allowed_tables


def _resolve_tables(
    table_expressions: list[exp.Table],
    conn: Any,
    db_config: _DatabaseConfigLike,
) -> set[str]:
    schemas = load_schemas(conn, db_config, _blocked)
    tables_by_schema: dict[str, list[str]] = {}
    return {
        ".".join(resolve_table(table, conn, schemas, tables_by_schema, db_config, _blocked))
        for table in table_expressions
    }


def _find_unlisted_tables(referenced_tables: set[str], allowed_tables: set[str]) -> list[str]:
    return sorted(referenced_tables - allowed_tables)


def _unlisted_message(unlisted_tables: list[str], allowed_tables: set[str]) -> str:
    names = ", ".join(unlisted_tables)
    message = (
        "Query blocked because allow_listed_only is enabled. "
        f"Unlisted table(s): {names}. Only synced context tables are allowed - "
        "list/read context to see them."
    )
    if not allowed_tables:
        return f"{message} No tables are currently present in synced context."

    return message


def _blocked(reason: str) -> AllowListedOnlyGuardError:
    return AllowListedOnlyGuardError(
        f"Query blocked because allow_listed_only is enabled and the query could not be safely validated: {reason}"
    )
