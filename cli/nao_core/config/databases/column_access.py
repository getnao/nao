from __future__ import annotations

from pathlib import Path
from typing import Any, Protocol

import sqlglot
from sqlglot import exp
from sqlglot.errors import OptimizeError, ParseError, SchemaError
from sqlglot.optimizer.qualify import qualify
from sqlglot.optimizer.scope import traverse_scope

from nao_core.commands.sync.cleanup import get_database_folder_names
from nao_core.config.databases.column_access_analysis import (
    ColumnAccessError,
    TableInfos,
    _blocked,
    _ColumnAccessAnalyzer,
    _table_key,
    _TableInfo,
)
from nao_core.config.databases.column_catalog import column_catalog_path, load_column_catalog


class _DatabaseConfigLike(Protocol):
    type: str
    exclude_columns: list[str]

    def get_database_name(self) -> str: ...

    def column_matches_pattern(self, schema: str, table: str, column: str) -> bool: ...


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

_STAR_EXCLUSION_KEYWORDS = {
    "bigquery": "EXCEPT",
    "clickhouse": "EXCEPT",
    "databricks": "EXCEPT",
    "duckdb": "EXCLUDE",
    "redshift": "EXCLUDE",
    "snowflake": "EXCLUDE",
    "starrocks": "EXCLUDE",
}


def validate_column_access(
    sql: str,
    db_config: _DatabaseConfigLike,
    project_path: Path,
) -> str:
    if not db_config.exclude_columns:
        return sql

    dialect = _SQLGLOT_DIALECTS.get(db_config.type)
    if dialect is None:
        raise _blocked(f"the database dialect '{db_config.type}' is not supported")

    expression = _parse_query(sql, dialect)
    if not any(expression.find_all(exp.Table)):
        return sql

    try:
        table_infos = _load_table_infos(expression, project_path, db_config)
        qualified = _qualify_query(expression, dialect, table_infos)
        analyzer = _ColumnAccessAnalyzer(qualified, table_infos, db_config)
        analyzer.validate_star_locations()
        excluded_references = analyzer.find_explicit_excluded_references()
        if excluded_references:
            names = ", ".join(sorted(origin.qualified_name for origin in excluded_references))
            raise ColumnAccessError(
                f"Query blocked because it explicitly references excluded column(s): {names}. "
                "Remove those column references and try again."
            )

        excluded_star_references = analyzer.find_excluded_star_references()
        if excluded_star_references:
            names = ", ".join(sorted(origin.qualified_name for origin in excluded_star_references))
            column_names = sorted({origin.column for origin in excluded_star_references})
            advice = _star_exclusion_advice(db_config.type, column_names)
            raise ColumnAccessError(
                f"Query blocked because SELECT * would include excluded column(s): {names}. {advice}"
            )
        return sql
    except ColumnAccessError:
        raise
    except Exception as error:
        raise _blocked(str(error)) from error


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


def _star_exclusion_advice(database_type: str, column_names: list[str]) -> str:
    keyword = _STAR_EXCLUSION_KEYWORDS.get(database_type)
    if keyword is None:
        return "Select only allowed columns explicitly instead of using *."
    columns = ", ".join(column_names)
    return f"Use SELECT * {keyword} ({columns}) to exclude them."


def _load_table_infos(
    expression: exp.Query,
    project_path: Path,
    db_config: _DatabaseConfigLike,
) -> TableInfos:
    database_folder = get_database_folder_names([db_config])[0]
    path = column_catalog_path(project_path, db_config.type, database_folder)
    catalog = load_column_catalog(path)
    infos: TableInfos = {}

    for scope in traverse_scope(expression):
        for source in scope.sources.values():
            if isinstance(source, exp.Table):
                infos.setdefault(_table_key(source), _resolve_table(source, catalog, db_config))
    return infos


def _resolve_table(
    table_expression: exp.Table,
    catalog: dict[str, dict[str, list[dict[str, str]]]],
    db_config: _DatabaseConfigLike,
) -> tuple[_TableInfo, ...]:
    requested_table = table_expression.name
    if not requested_table:
        raise _blocked("a dynamic table reference could not be resolved")

    requested_catalog = table_expression.catalog
    if requested_catalog:
        database_name = db_config.get_database_name()
        if not _catalog_matches_database(requested_catalog, database_name):
            raise _blocked(f"catalog '{requested_catalog}' does not match the configured database '{database_name}'")

    requested_schema = table_expression.db
    if requested_schema:
        schema_candidates = [requested_schema]
        if requested_catalog:
            schema_candidates.insert(0, f"{requested_catalog}.{requested_schema}")
        schema = next(
            (
                matched
                for candidate in schema_candidates
                if (matched := _match_identifier(candidate, list(catalog))) is not None
            ),
            schema_candidates[0],
        )
        return (_table_info(catalog, schema, requested_table),)

    matches = [
        _table_info(catalog, schema, requested_table)
        for schema, tables in catalog.items()
        if _match_identifier(requested_table, list(tables)) is not None
    ]
    if matches:
        return tuple(matches)
    if len(catalog) == 1:
        return (_TableInfo(schema=next(iter(catalog)), table=requested_table, columns=()),)
    return (_TableInfo(schema="", table=requested_table, columns=()),)


def _table_info(
    catalog: dict[str, dict[str, list[dict[str, str]]]],
    schema: str,
    requested_table: str,
) -> _TableInfo:
    tables = catalog.get(schema, {})
    table = _match_identifier(requested_table, list(tables)) or requested_table
    columns = tuple(column["name"] for column in tables.get(table, []))
    return _TableInfo(schema=schema, table=table, columns=columns)


def _match_identifier(requested: str, available: list[str]) -> str | None:
    if requested in available:
        return requested
    matches = [value for value in available if value.casefold() == requested.casefold()]
    return matches[0] if len(matches) == 1 else None


def _catalog_matches_database(requested_catalog: str, database_name: str) -> bool:
    parts = database_name.split(".")
    candidates = [".".join(parts[:index]) for index in range(1, len(parts) + 1)]
    return _match_identifier(requested_catalog, candidates) is not None


def _qualify_query(
    expression: exp.Query,
    dialect: str,
    table_infos: TableInfos,
) -> exp.Query:
    expression = expression.copy()
    for scope in traverse_scope(expression):
        for source in scope.sources.values():
            if not isinstance(source, exp.Table) or source.db:
                continue
            infos = table_infos.get(_table_key(source), ())
            if len(infos) != 1 or not infos[0].schema:
                continue
            original_key = _table_key(source)
            _set_table_schema(source, infos[0].schema)
            table_infos[_table_key(source)] = table_infos[original_key]

    schema: dict[str, Any] = {}
    for infos in table_infos.values():
        for info in infos:
            if not info.schema or not info.columns:
                continue
            current = schema
            for part in info.schema.split("."):
                current = current.setdefault(part, {})
            current[info.table] = {column: "UNKNOWN" for column in info.columns}

    try:
        qualified = _run_qualify(expression, dialect, schema)
    except SchemaError:
        qualified = _run_qualify(expression, dialect, {})
    except OptimizeError as error:
        raise _blocked(f"column references could not be resolved: {error}") from error

    if not isinstance(qualified, exp.Query):
        raise _blocked("the parsed statement is not a query")
    return qualified


def _run_qualify(expression: exp.Query, dialect: str, schema: dict[str, Any]) -> exp.Expr:
    return qualify(
        expression,
        dialect=dialect,
        schema=schema,
        expand_stars=False,
        infer_schema=True,
        quote_identifiers=False,
        identify=False,
        validate_qualify_columns=False,
    )


def _set_table_schema(table: exp.Table, schema: str) -> None:
    parts = schema.split(".")
    if len(parts) == 1:
        table.set("db", exp.to_identifier(parts[0]))
    elif len(parts) == 2:
        table.set("catalog", exp.to_identifier(parts[0]))
        table.set("db", exp.to_identifier(parts[1]))
    else:
        raise _blocked(f"schema identifier '{schema}' cannot be qualified safely")
