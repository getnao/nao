from __future__ import annotations

from pathlib import Path
from typing import Any, Callable, Protocol

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


TableIdentity = tuple[str, str]


def enforce_allow_listed_only(
    sql: str,
    db_config: _DatabaseConfigLike,
    project_folder: str | Path,
    conn: Any | None = None,
    group_allowed_tables: set[TableIdentity] | None = None,
    database_folder: str | None = None,
) -> str:
    if not db_config.allow_listed_only and group_allowed_tables is None:
        return sql

    owns_connection = conn is None
    try:
        blocked = _blocked if db_config.allow_listed_only else _context_blocked
        dialect = SQLGLOT_DIALECTS.get(db_config.type)
        if dialect is None:
            raise blocked(f"the database dialect '{db_config.type}' is not supported")

        expression = parse_query(sql, dialect, blocked)
        table_expressions = base_table_expressions(expression, blocked)
        if not table_expressions:
            return sql

        if conn is None:
            conn = db_config.connect()
        referenced_tables = _resolve_tables(table_expressions, conn, db_config, dialect, blocked)

        if group_allowed_tables is not None:
            denied_tables = _find_unlisted_tables(referenced_tables, group_allowed_tables)
            if denied_tables:
                raise AllowListedOnlyGuardError(_context_access_message(denied_tables))

        if db_config.allow_listed_only:
            allowed_context_tables = load_allowed_context_tables(
                project_folder, db_config, database_folder=database_folder
            )
            unlisted_tables = _find_unlisted_tables(referenced_tables, allowed_context_tables)
            if unlisted_tables:
                raise AllowListedOnlyGuardError(_unlisted_message(unlisted_tables, allowed_context_tables))
        return sql
    except AllowListedOnlyGuardError:
        raise
    except Exception as error:
        raise blocked(str(error)) from error
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
    database_folder: str | None = None,
) -> set[TableIdentity]:
    database_folder = database_folder or get_database_folder_names([db_config])[0]
    database_path = Path(project_folder) / "databases" / f"type={db_config.type}" / database_folder
    if not database_path.is_dir():
        return set()

    allowed_tables: set[TableIdentity] = set()
    for schema_path in database_path.iterdir():
        if not schema_path.is_dir() or not schema_path.name.startswith("schema="):
            continue
        schema = schema_path.name.removeprefix("schema=")
        for table_path in schema_path.iterdir():
            if not table_path.is_dir() or not table_path.name.startswith("table="):
                continue
            table = table_path.name.removeprefix("table=")
            allowed_tables.add((schema, table))
    return allowed_tables


def _resolve_tables(
    table_expressions: list[exp.Table],
    conn: Any,
    db_config: _DatabaseConfigLike,
    dialect: str,
    blocked: Callable[[str], AllowListedOnlyGuardError],
) -> set[TableIdentity]:
    schemas = load_schemas(conn, db_config, blocked)
    tables_by_schema: dict[str, list[str]] = {}
    return {
        resolve_table(
            table,
            conn,
            schemas,
            tables_by_schema,
            db_config,
            dialect,
            blocked,
        )
        for table in table_expressions
    }


def _find_unlisted_tables(
    referenced_tables: set[TableIdentity],
    allowed_tables: set[TableIdentity],
) -> list[TableIdentity]:
    return sorted(referenced_tables - allowed_tables)


def _unlisted_message(
    unlisted_tables: list[TableIdentity],
    allowed_tables: set[TableIdentity],
) -> str:
    names = ", ".join(_display_table(table) for table in unlisted_tables)
    message = (
        "Query blocked because allow_listed_only is enabled. "
        f"Unlisted table(s): {names}. Only synced context tables are allowed - "
        "list/read context to see them."
    )
    if not allowed_tables:
        return f"{message} No tables are currently present in synced context."

    return message


def _context_access_message(denied_tables: list[TableIdentity]) -> str:
    names = ", ".join(_display_table(table) for table in denied_tables)
    return f"Query blocked by Context table permissions. Denied table(s): {names}."


def _display_table(identity: TableIdentity) -> str:
    schema, table = identity
    return f"{schema}.{table}"


def _blocked(reason: str) -> AllowListedOnlyGuardError:
    return AllowListedOnlyGuardError(
        f"Query blocked because allow_listed_only is enabled and the query could not be safely validated: {reason}"
    )


def _context_blocked(reason: str) -> AllowListedOnlyGuardError:
    return AllowListedOnlyGuardError(
        f"Query blocked because Context table permissions are enforced and the query could not be safely validated: {reason}"
    )
