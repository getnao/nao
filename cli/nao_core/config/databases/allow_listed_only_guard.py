from __future__ import annotations

from pathlib import Path
from typing import Any, Protocol

import sqlglot
from sqlglot import exp
from sqlglot.errors import ParseError
from sqlglot.optimizer.scope import traverse_scope

from nao_core.commands.sync.cleanup import get_database_folder_names


class _DatabaseConfigLike(Protocol):
    type: str
    name: str
    allow_listed_only: bool

    def connect(self) -> Any: ...

    def get_database_name(self) -> str: ...

    def get_schemas(self, conn: Any) -> list[str]: ...


_SQLGLOT_DIALECTS = {
    "athena": "athena",
    "bigquery": "bigquery",
    "clickhouse": "clickhouse",
    "duckdb": "duckdb",
    "databricks": "databricks",
    "fabric": "tsql",
    "snowflake": "snowflake",
    "mssql": "tsql",
    "mysql": "mysql",
    "postgres": "postgres",
    "redshift": "redshift",
    "starrocks": "mysql",
    "trino": "trino",
}


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
        dialect = _SQLGLOT_DIALECTS.get(db_config.type)
        if dialect is None:
            raise _blocked(f"the database dialect '{db_config.type}' is not supported")

        expression = _parse_query(sql, dialect)
        table_expressions = _base_table_expressions(expression)
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


def _parse_query(sql: str, dialect: str) -> exp.Query:
    try:
        statements = sqlglot.parse(sql, read=dialect)
    except ParseError as error:
        raise _blocked(f"the SQL could not be parsed: {error}") from error

    if len(statements) != 1 or statements[0] is None:
        raise _blocked("exactly one SQL statement is required")

    expression = statements[0]
    if not isinstance(expression, exp.Query):
        raise _blocked("only query statements can be validated")
    return expression


def _base_table_expressions(expression: exp.Query) -> list[exp.Table]:
    tables: list[exp.Table] = []
    seen: set[int] = set()
    for scope in traverse_scope(expression):
        for source in scope.sources.values():
            if not isinstance(source, exp.Table) or id(source) in seen:
                continue
            seen.add(id(source))
            tables.append(source)

    if not tables and any(expression.find_all(exp.Table)):
        raise _blocked("the query's table references could not be resolved")
    return tables


def _resolve_tables(
    table_expressions: list[exp.Table],
    conn: Any,
    db_config: _DatabaseConfigLike,
) -> set[str]:
    try:
        schemas = [str(schema) for schema in db_config.get_schemas(conn)]
    except Exception as error:
        raise _blocked(f"live schemas could not be listed: {error}") from error

    tables_by_schema: dict[str, list[str]] = {}
    return {".".join(_resolve_table(table, conn, schemas, tables_by_schema, db_config)) for table in table_expressions}


def _resolve_table(
    table_expression: exp.Table,
    conn: Any,
    schemas: list[str],
    tables_by_schema: dict[str, list[str]],
    db_config: _DatabaseConfigLike,
) -> tuple[str, str]:
    requested_table = table_expression.name
    if not requested_table:
        raise _blocked("a dynamic table reference could not be resolved")

    requested_catalog = table_expression.catalog
    if requested_catalog:
        database_name = db_config.get_database_name()
        if not _catalog_matches_database(requested_catalog, database_name):
            raise _blocked(f"catalog '{requested_catalog}' does not match the connected database '{database_name}'")

    requested_schema = table_expression.db
    if requested_schema:
        schema_candidates = [requested_schema]
        if requested_catalog:
            schema_candidates.insert(0, f"{requested_catalog}.{requested_schema}")
        schema = next(
            (
                matched
                for candidate in schema_candidates
                if (matched := _match_identifier(candidate, schemas)) is not None
            ),
            schema_candidates[0],
        )
        table = _find_table(conn, schema, requested_table, tables_by_schema)
        if table is None:
            raise _blocked(f"table {schema}.{requested_table} was not found in the live schema")
        return schema, table

    matches: list[tuple[str, str]] = []
    for schema in schemas:
        table = _find_table(conn, schema, requested_table, tables_by_schema)
        if table is not None:
            matches.append((schema, table))

    if len(matches) == 1:
        return matches[0]
    if not matches:
        raise _blocked(f"unqualified table {requested_table} was not found in the live schema")
    matched_names = ", ".join(f"{schema}.{table}" for schema, table in matches)
    raise _blocked(f"unqualified table {requested_table} is ambiguous across: {matched_names}")


def _find_table(
    conn: Any,
    schema: str,
    requested_table: str,
    tables_by_schema: dict[str, list[str]],
) -> str | None:
    if schema not in tables_by_schema:
        try:
            tables_by_schema[schema] = [str(table) for table in conn.list_tables(database=schema)]
        except Exception as error:
            raise _blocked(f"tables could not be listed for schema {schema}: {error}") from error
    return _match_identifier(requested_table, tables_by_schema[schema])


def _match_identifier(requested: str, available: list[str]) -> str | None:
    if requested in available:
        return requested
    matches = [value for value in available if value.casefold() == requested.casefold()]
    return matches[0] if len(matches) == 1 else None


def _catalog_matches_database(requested_catalog: str, database_name: str) -> bool:
    parts = database_name.split(".")
    candidates = [".".join(parts[:index]) for index in range(1, len(parts) + 1)]
    return _match_identifier(requested_catalog, candidates) is not None


def _find_unlisted_tables(referenced_tables: set[str], allowed_tables: set[str]) -> list[str]:
    allowed_by_normalized_name = {table.casefold(): table for table in allowed_tables}
    return sorted(table for table in referenced_tables if table.casefold() not in allowed_by_normalized_name)


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
