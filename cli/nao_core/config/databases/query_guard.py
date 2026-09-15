from __future__ import annotations

from typing import Any, Callable, Protocol

import sqlglot
from sqlglot import exp
from sqlglot.errors import ParseError
from sqlglot.optimizer.scope import traverse_scope


class DatabaseConfigLike(Protocol):
    type: str

    def get_database_name(self) -> str: ...

    def get_schemas(self, conn: Any) -> list[str]: ...


BlockedFactory = Callable[[str], Exception]

SQLGLOT_DIALECTS = {
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


def parse_query(sql: str, dialect: str, blocked: BlockedFactory) -> exp.Query:
    try:
        statements = sqlglot.parse(sql, read=dialect)
    except ParseError as error:
        raise blocked(f"the SQL could not be parsed: {error}") from error

    if len(statements) != 1 or statements[0] is None:
        raise blocked("exactly one SQL statement is required")

    expression = statements[0]
    if not isinstance(expression, exp.Query):
        raise blocked("only query statements can be validated")
    return expression


def base_table_expressions(expression: exp.Query, blocked: BlockedFactory) -> list[exp.Table]:
    tables: list[exp.Table] = []
    seen: set[int] = set()
    for scope in traverse_scope(expression):
        for source in scope.sources.values():
            if not isinstance(source, exp.Table) or id(source) in seen:
                continue
            seen.add(id(source))
            tables.append(source)

    if not tables and any(expression.find_all(exp.Table)):
        raise blocked("the query's table references could not be resolved")
    return tables


def load_schemas(
    conn: Any,
    db_config: DatabaseConfigLike,
    blocked: BlockedFactory,
) -> list[str]:
    try:
        return [str(schema) for schema in db_config.get_schemas(conn)]
    except Exception as error:
        raise blocked(f"live schemas could not be listed: {error}") from error


def resolve_table(
    table_expression: exp.Table,
    conn: Any,
    schemas: list[str],
    tables_by_schema: dict[str, list[str]],
    db_config: DatabaseConfigLike,
    blocked: BlockedFactory,
) -> tuple[str, str]:
    requested_table = table_expression.name
    if not requested_table:
        raise blocked("a dynamic table reference could not be resolved")

    requested_catalog = table_expression.catalog
    if requested_catalog:
        database_name = db_config.get_database_name()
        if not _catalog_matches_connection(requested_catalog, database_name, schemas):
            raise blocked(f"catalog '{requested_catalog}' does not match the connected database '{database_name}'")

    requested_schema = table_expression.db
    if requested_schema:
        schema_candidates = [requested_schema]
        if requested_catalog:
            schema_candidates.insert(0, f"{requested_catalog}.{requested_schema}")
        match_schema = match_identifier if requested_catalog else match_schema_identifier
        schema = next(
            (matched for candidate in schema_candidates if (matched := match_schema(candidate, schemas)) is not None),
            schema_candidates[0],
        )
        table = _find_table(conn, schema, requested_table, tables_by_schema, blocked)
        if table is None:
            raise blocked(f"table {schema}.{requested_table} was not found in the live schema")
        return schema, table

    matches: list[tuple[str, str]] = []
    for schema in schemas:
        table = _find_table(conn, schema, requested_table, tables_by_schema, blocked)
        if table is not None:
            matches.append((schema, table))

    if len(matches) == 1:
        return matches[0]
    if not matches:
        raise blocked(f"unqualified table {requested_table} was not found in the live schema")
    matched_names = ", ".join(f"{schema}.{table}" for schema, table in matches)
    raise blocked(f"unqualified table {requested_table} is ambiguous across: {matched_names}")


def match_identifier(requested: str, available: list[str]) -> str | None:
    if requested in available:
        return requested
    matches = [value for value in available if value.casefold() == requested.casefold()]
    return matches[0] if len(matches) == 1 else None


def match_schema_identifier(requested: str, available: list[str]) -> str | None:
    if matched := match_identifier(requested, available):
        return matched
    matches = [value for value in available if value.rsplit(".", 1)[-1].casefold() == requested.casefold()]
    return matches[0] if len(matches) == 1 else None


def _find_table(
    conn: Any,
    schema: str,
    requested_table: str,
    tables_by_schema: dict[str, list[str]],
    blocked: BlockedFactory,
) -> str | None:
    if schema not in tables_by_schema:
        try:
            tables_by_schema[schema] = [str(table) for table in conn.list_tables(database=schema)]
        except Exception as error:
            raise blocked(f"tables could not be listed for schema {schema}: {error}") from error
    return match_identifier(requested_table, tables_by_schema[schema])


def _catalog_matches_connection(
    requested_catalog: str,
    database_name: str,
    schemas: list[str],
) -> bool:
    database_parts = database_name.split(".")
    database_candidates = [".".join(database_parts[:index]) for index in range(1, len(database_parts) + 1)]
    schema_catalogs = [schema.rsplit(".", 1)[0] for schema in schemas if "." in schema]
    return _catalog_in(requested_catalog, database_candidates) or _catalog_in(requested_catalog, schema_catalogs)


def _catalog_in(requested: str, candidates: list[str]) -> bool:
    if requested in candidates:
        return True
    folded = requested.casefold()
    return any(candidate.casefold() == folded for candidate in candidates)
