from __future__ import annotations

from dataclasses import dataclass
from typing import TYPE_CHECKING, Any, Protocol

import sqlglot
from sqlglot import exp
from sqlglot.errors import OptimizeError, ParseError
from sqlglot.optimizer.qualify import qualify
from sqlglot.optimizer.scope import Scope, traverse_scope

if TYPE_CHECKING:
    from ibis import BaseBackend


class _DatabaseConfigLike(Protocol):
    type: str
    exclude_columns: list[str]

    def connect(self) -> Any: ...

    def get_database_name(self) -> str: ...

    def get_schemas(self, conn: Any) -> list[str]: ...

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


class ColumnAccessError(ValueError):
    pass


@dataclass(frozen=True)
class _ColumnOrigin:
    schema: str
    table: str
    column: str

    @property
    def qualified_name(self) -> str:
        return f"{self.schema}.{self.table}.{self.column}"


@dataclass(frozen=True)
class _TableInfo:
    schema: str
    table: str
    columns: tuple[str, ...]


@dataclass(frozen=True)
class _OutputColumn:
    name: str
    origins: frozenset[_ColumnOrigin]


def validate_column_access(
    sql: str,
    db_config: _DatabaseConfigLike,
) -> str:
    if not db_config.exclude_columns:
        return sql

    dialect = _SQLGLOT_DIALECTS.get(db_config.type)
    if dialect is None:
        raise _blocked(f"the database dialect '{db_config.type}' is not supported")

    expression = _parse_query(sql, dialect)
    if not any(expression.find_all(exp.Table)):
        return sql

    conn = db_config.connect()
    try:
        table_infos = _load_table_infos(expression, conn, db_config)
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
            raise ColumnAccessError(
                f"Query blocked because SELECT * would include excluded column(s): {names}. "
                "Select only allowed columns explicitly instead of using *."
            )
        return sql
    except ColumnAccessError:
        raise
    except Exception as error:
        raise _blocked(str(error)) from error
    finally:
        conn.disconnect()


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


def _load_table_infos(
    expression: exp.Query,
    conn: BaseBackend,
    db_config: _DatabaseConfigLike,
) -> dict[tuple[str, str, str], _TableInfo]:
    schemas = _load_schemas(conn, db_config)
    tables_by_schema: dict[str, list[str]] = {}
    infos: dict[tuple[str, str, str], _TableInfo] = {}

    for scope in traverse_scope(expression):
        for source in scope.sources.values():
            if not isinstance(source, exp.Table):
                continue
            key = _table_key(source)
            if key in infos:
                continue
            schema, table = _resolve_table(source, conn, schemas, tables_by_schema, db_config)
            try:
                ibis_schema = conn.table(table, database=schema).schema()
            except Exception as error:
                raise _blocked(f"live schema could not be loaded for {schema}.{table}: {error}") from error
            columns = tuple(str(name) for name, _ in ibis_schema.items())
            if not columns:
                raise _blocked(f"live schema returned no columns for {schema}.{table}")
            infos[key] = _TableInfo(schema=schema, table=table, columns=columns)

    if not infos and any(expression.find_all(exp.Table)):
        raise _blocked("the query's table references could not be resolved")
    return infos


def _load_schemas(conn: BaseBackend, db_config: _DatabaseConfigLike) -> list[str]:
    try:
        schemas = db_config.get_schemas(conn)
    except Exception as error:
        raise _blocked(f"live schemas could not be listed: {error}") from error
    return [str(schema) for schema in schemas]


def _resolve_table(
    table_expression: exp.Table,
    conn: BaseBackend,
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
    conn: BaseBackend,
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


def _qualify_query(
    expression: exp.Query,
    dialect: str,
    table_infos: dict[tuple[str, str, str], _TableInfo],
) -> exp.Query:
    expression = expression.copy()
    for scope in traverse_scope(expression):
        for source in scope.sources.values():
            if not isinstance(source, exp.Table) or source.db:
                continue
            info = table_infos.get(_table_key(source))
            if info is None:
                continue
            schema_parts = info.schema.split(".")
            if len(schema_parts) == 1:
                source.set("db", exp.to_identifier(schema_parts[0]))
            elif len(schema_parts) == 2:
                source.set("catalog", exp.to_identifier(schema_parts[0]))
                source.set("db", exp.to_identifier(schema_parts[1]))
            else:
                raise _blocked(f"schema identifier '{info.schema}' cannot be qualified safely")
            table_infos[_table_key(source)] = info

    schema: dict[str, Any] = {}
    for info in table_infos.values():
        current = schema
        for part in info.schema.split("."):
            current = current.setdefault(part, {})
        current[info.table] = {column: "UNKNOWN" for column in info.columns}

    try:
        qualified = qualify(
            expression,
            dialect=dialect,
            schema=schema,
            expand_stars=False,
            infer_schema=True,
            quote_identifiers=False,
            identify=False,
            validate_qualify_columns=True,
        )
    except OptimizeError as error:
        raise _blocked(f"column references could not be resolved: {error}") from error

    if not isinstance(qualified, exp.Query):
        raise _blocked("the parsed statement is not a query")
    return qualified


class _ColumnAccessAnalyzer:
    def __init__(
        self,
        expression: exp.Query,
        table_infos: dict[tuple[str, str, str], _TableInfo],
        db_config: _DatabaseConfigLike,
    ):
        self.expression = expression
        self.table_infos = table_infos
        self.db_config = db_config
        self.scopes = list(traverse_scope(expression))
        self._output_cache: dict[int, list[_OutputColumn]] = {}

    def validate_star_locations(self) -> None:
        for star in self.expression.find_all(exp.Star):
            parent = star.parent
            if isinstance(parent, exp.Count):
                continue
            projection = parent if isinstance(parent, exp.Column) else star
            if isinstance(projection.parent, exp.Select) and projection in projection.parent.selects:
                continue
            raise _blocked("star expansion nested inside an expression cannot be resolved safely")

    def find_explicit_excluded_references(self) -> set[_ColumnOrigin]:
        excluded: set[_ColumnOrigin] = set()
        for scope in self.scopes:
            for column in scope.columns:
                origins = self._resolve_column(scope, column)
                excluded.update(origin for origin in origins if self._is_excluded(origin))
        return excluded

    def find_excluded_star_references(self) -> set[_ColumnOrigin]:
        excluded: set[_ColumnOrigin] = set()
        for scope in self.scopes:
            if not isinstance(scope.expression, exp.Select):
                selects = getattr(scope.expression, "selects", [])
                if any(select.is_star for select in selects):
                    raise _blocked("star expansion in this query shape cannot be resolved safely")
                continue

            for select in scope.expression.selects:
                if not select.is_star:
                    continue
                star = _star_expression(select)
                if star.args.get("replace") or star.args.get("rename"):
                    raise _blocked("SELECT * REPLACE/RENAME cannot be resolved safely")

                star_outputs = self._star_outputs(scope, select)
                excluded_names = {item.name.casefold() for item in star.args.get("except_") or [] if item.name}
                for output in star_outputs:
                    if output.name.casefold() in excluded_names:
                        continue
                    excluded_origins = {origin for origin in output.origins if self._is_excluded(origin)}
                    excluded.update(excluded_origins)
            if excluded:
                return excluded

        return excluded

    def _star_outputs(self, scope: Scope, select: exp.Expr) -> list[_OutputColumn]:
        if isinstance(select, exp.Column):
            source_alias = select.table
            source = scope.sources.get(source_alias)
            if source is None:
                raise _blocked(f"qualified star {source_alias}.* could not be resolved")
            return self._source_outputs(source)

        outputs: list[_OutputColumn] = []
        for _, source in scope.selected_sources.values():
            outputs.extend(self._source_outputs(source))
        if not outputs:
            raise _blocked("SELECT * had no resolvable source columns")
        return outputs

    def _source_outputs(self, source: exp.Expr | Scope) -> list[_OutputColumn]:
        if isinstance(source, exp.Table):
            info = self._table_info(source)
            return [
                _OutputColumn(
                    name=column,
                    origins=frozenset({_ColumnOrigin(info.schema, info.table, column)}),
                )
                for column in info.columns
            ]
        if isinstance(source, Scope):
            return self._scope_outputs(source)
        raise _blocked(f"source type {type(source).__name__} cannot be resolved safely")

    def _scope_outputs(self, scope: Scope) -> list[_OutputColumn]:
        cache_key = id(scope)
        if cache_key in self._output_cache:
            return self._output_cache[cache_key]
        if not isinstance(scope.expression, exp.Select):
            raise _blocked("derived query outputs cannot be resolved safely")

        outputs: list[_OutputColumn] = []
        names: set[str] = set()
        for select in scope.expression.selects:
            if select.is_star:
                raise _blocked("nested star expansion could not be resolved safely")
            name = select.alias_or_name
            if not name:
                raise _blocked("a derived output column has no stable name")
            normalized_name = name.casefold()
            if normalized_name in names:
                raise _blocked(f"derived query has duplicate output column '{name}'")
            names.add(normalized_name)
            origins = self._projection_origins(scope, select)
            outputs.append(_OutputColumn(name=name, origins=frozenset(origins)))

        self._output_cache[cache_key] = outputs
        return outputs

    def _projection_origins(self, scope: Scope, projection: exp.Expr) -> set[_ColumnOrigin]:
        scope_columns = {id(column): column for column in scope.columns}
        origins: set[_ColumnOrigin] = set()
        for column in projection.find_all(exp.Column):
            if id(column) in scope_columns:
                origins.update(self._resolve_column(scope, column))
        return origins

    def _resolve_column(self, scope: Scope, column: exp.Column) -> set[_ColumnOrigin]:
        if not column.table:
            raise _blocked(f"column '{column.name}' could not be tied to a source")
        source = scope.sources.get(column.table)
        if source is None:
            parent = scope.parent
            while parent is not None and source is None:
                source = parent.sources.get(column.table)
                scope = parent
                parent = parent.parent
        if source is None:
            raise _blocked(f"source alias '{column.table}' could not be resolved")

        if isinstance(source, exp.Table):
            info = self._table_info(source)
            actual_column = _match_identifier(column.name, list(info.columns))
            if actual_column is None:
                raise _blocked(f"column {column.table}.{column.name} was not found in the live schema")
            return {_ColumnOrigin(info.schema, info.table, actual_column)}
        if isinstance(source, Scope):
            return self._resolve_scope_output(source, column.name)
        raise _blocked(f"column source type {type(source).__name__} cannot be resolved safely")

    def _resolve_scope_output(self, scope: Scope, column_name: str) -> set[_ColumnOrigin]:
        outputs = self._scope_outputs_with_stars(scope)
        matches = [output for output in outputs if output.name.casefold() == column_name.casefold()]
        if len(matches) != 1:
            raise _blocked(f"derived column '{column_name}' could not be resolved unambiguously")
        return set(matches[0].origins)

    def _scope_outputs_with_stars(self, scope: Scope) -> list[_OutputColumn]:
        if not isinstance(scope.expression, exp.Select):
            raise _blocked("derived query outputs cannot be resolved safely")
        outputs: list[_OutputColumn] = []
        for select in scope.expression.selects:
            if select.is_star:
                outputs.extend(self._star_outputs(scope, select))
                continue
            name = select.alias_or_name
            if not name:
                raise _blocked("a derived output column has no stable name")
            outputs.append(_OutputColumn(name=name, origins=frozenset(self._projection_origins(scope, select))))
        return outputs

    def _table_info(self, table: exp.Table) -> _TableInfo:
        info = self.table_infos.get(_table_key(table))
        if info is None:
            raise _blocked(f"table {table.sql()} was not resolved against the live schema")
        return info

    def _is_excluded(self, origin: _ColumnOrigin) -> bool:
        return not self.db_config.column_matches_pattern(origin.schema, origin.table, origin.column)


def _table_key(table: exp.Table) -> tuple[str, str, str]:
    return (table.catalog.casefold(), table.db.casefold(), table.name.casefold())


def _star_expression(expression: exp.Expr) -> exp.Star:
    if isinstance(expression, exp.Star):
        return expression
    if isinstance(expression, exp.Column) and isinstance(expression.this, exp.Star):
        return expression.this
    raise _blocked("star expression could not be resolved")


def _blocked(reason: str) -> ColumnAccessError:
    return ColumnAccessError(f"Query blocked because exclude_columns could not safely validate it: {reason}")
