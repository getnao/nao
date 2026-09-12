from __future__ import annotations

from typing import Any, Callable, Protocol

import sqlglot
from sqlglot import Dialect, exp
from sqlglot.dialects.dialect import NormalizationStrategy
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
    "motherduck": "duckdb",
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
    dialect: str,
    blocked: BlockedFactory,
) -> tuple[str, str]:
    case_insensitive = db_config.type == "starrocks"
    requested_table = table_expression.args.get("this")
    if not isinstance(requested_table, exp.Identifier) or not requested_table.name:
        raise blocked("a dynamic table reference could not be resolved")

    requested_catalog = table_expression.args.get("catalog")
    if requested_catalog is not None and not isinstance(requested_catalog, exp.Identifier):
        raise blocked("a dynamic catalog reference could not be resolved")
    if requested_catalog:
        database_name = db_config.get_database_name()
        if not _catalog_matches_connection(
            requested_catalog,
            database_name,
            schemas,
            dialect,
            case_insensitive=case_insensitive,
        ):
            raise blocked(f"catalog '{requested_catalog.name}' does not match the connected database '{database_name}'")

    requested_schema = table_expression.args.get("db")
    if requested_schema is not None and not isinstance(requested_schema, exp.Identifier):
        raise blocked("a dynamic schema reference could not be resolved")
    if requested_schema:
        if requested_catalog:
            combined_schema = _join_identifiers(requested_catalog, requested_schema, dialect)
            schema = match_sql_identifier(
                combined_schema,
                schemas,
                dialect,
                case_insensitive=case_insensitive,
            )
            if schema is None and not any("." in available for available in schemas):
                schema = match_sql_identifier(
                    requested_schema,
                    schemas,
                    dialect,
                    case_insensitive=case_insensitive,
                )
            schema = schema or _normalized_identifier(combined_schema, dialect)
        else:
            schema = match_schema_identifier(
                requested_schema,
                schemas,
                dialect,
                case_insensitive=case_insensitive,
            ) or _normalized_identifier(requested_schema, dialect)
        table = _find_table(
            conn,
            schema,
            requested_table,
            tables_by_schema,
            dialect,
            blocked,
            case_insensitive=case_insensitive,
        )
        if table is None:
            raise blocked(f"table {schema}.{requested_table.name} was not found in the live schema")
        return schema, table

    matches: list[tuple[str, str]] = []
    for schema in schemas:
        table = _find_table(
            conn,
            schema,
            requested_table,
            tables_by_schema,
            dialect,
            blocked,
            case_insensitive=case_insensitive,
        )
        if table is not None:
            matches.append((schema, table))

    if len(matches) == 1:
        return matches[0]
    if not matches:
        raise blocked(f"unqualified table {requested_table.name} was not found in the live schema")
    matched_names = ", ".join(f"{schema}.{table}" for schema, table in matches)
    raise blocked(f"unqualified table {requested_table.name} is ambiguous across: {matched_names}")


def match_identifier(requested: str, available: list[str]) -> str | None:
    if requested in available:
        return requested
    matches = [value for value in available if value.casefold() == requested.casefold()]
    return matches[0] if len(matches) == 1 else None


def match_sql_identifier(
    requested: exp.Identifier,
    available: list[str],
    dialect: str,
    *,
    case_insensitive: bool = False,
) -> str | None:
    available = list(dict.fromkeys(available))
    matches = [
        value
        for value in available
        if _identifier_matches_metadata(requested, value, dialect, case_insensitive=case_insensitive)
    ]
    return matches[0] if len(matches) == 1 else None


def match_schema_identifier(
    requested: exp.Identifier,
    available: list[str],
    dialect: str,
    *,
    case_insensitive: bool = False,
) -> str | None:
    if matched := match_sql_identifier(requested, available, dialect, case_insensitive=case_insensitive):
        return matched
    matches = [
        value
        for value in available
        if _identifier_matches_metadata(
            requested,
            value.rsplit(".", 1)[-1],
            dialect,
            case_insensitive=case_insensitive,
        )
    ]
    return matches[0] if len(matches) == 1 else None


def _find_table(
    conn: Any,
    schema: str,
    requested_table: exp.Identifier,
    tables_by_schema: dict[str, list[str]],
    dialect: str,
    blocked: BlockedFactory,
    *,
    case_insensitive: bool = False,
) -> str | None:
    if schema not in tables_by_schema:
        try:
            tables_by_schema[schema] = [str(table) for table in conn.list_tables(database=schema)]
        except Exception as error:
            raise blocked(f"tables could not be listed for schema {schema}: {error}") from error
    return match_sql_identifier(
        requested_table,
        tables_by_schema[schema],
        dialect,
        case_insensitive=case_insensitive,
    )


def _catalog_matches_connection(
    requested_catalog: exp.Identifier,
    database_name: str,
    schemas: list[str],
    dialect: str,
    *,
    case_insensitive: bool = False,
) -> bool:
    database_parts = database_name.split(".")
    database_candidates = [".".join(database_parts[:index]) for index in range(1, len(database_parts) + 1)]
    schema_catalogs = [schema.rsplit(".", 1)[0] for schema in schemas if "." in schema]
    return (
        match_sql_identifier(
            requested_catalog,
            database_candidates,
            dialect,
            case_insensitive=case_insensitive,
        )
        is not None
        or match_sql_identifier(
            requested_catalog,
            schema_catalogs,
            dialect,
            case_insensitive=case_insensitive,
        )
        is not None
    )


def _identifier_matches_metadata(
    requested: exp.Identifier,
    available: str,
    dialect: str,
    *,
    case_insensitive: bool = False,
) -> bool:
    if requested.args.get("quoted"):
        return requested.name == available

    normalized = _normalized_identifier(requested, dialect)
    if case_insensitive:
        return normalized.casefold() == available.casefold()

    strategy = Dialect.get_or_raise(dialect).NORMALIZATION_STRATEGY
    if strategy in {
        NormalizationStrategy.CASE_INSENSITIVE,
        NormalizationStrategy.CASE_INSENSITIVE_UPPERCASE,
    }:
        available_identifier = exp.to_identifier(available)
        return normalized == _normalized_identifier(available_identifier, dialect)
    return normalized == available


def _normalized_identifier(identifier: exp.Identifier, dialect: str) -> str:
    normalized = identifier.copy()
    Dialect.get_or_raise(dialect).normalize_identifier(normalized)
    return normalized.name


def _join_identifiers(
    left: exp.Identifier,
    right: exp.Identifier,
    dialect: str,
) -> exp.Identifier:
    return exp.to_identifier(
        f"{_normalized_identifier(left, dialect)}.{_normalized_identifier(right, dialect)}",
        quoted=bool(left.args.get("quoted") or right.args.get("quoted")),
    )
