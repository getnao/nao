from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol

from sqlglot import exp
from sqlglot.optimizer.scope import Scope, traverse_scope


class _DatabaseConfigLike(Protocol):
    def column_matches_pattern(self, schema: str, table: str, column: str) -> bool: ...


class ColumnAccessError(ValueError):
    pass


@dataclass(frozen=True)
class _ColumnOrigin:
    schema: str
    table: str
    column: str

    @property
    def qualified_name(self) -> str:
        parts = [part for part in (self.schema, self.table, self.column) if part]
        return ".".join(parts)


@dataclass(frozen=True)
class _TableInfo:
    schema: str
    table: str
    columns: tuple[str, ...]


@dataclass(frozen=True)
class _OutputColumn:
    name: str
    origins: frozenset[_ColumnOrigin]


TableKey = tuple[str, str, str]
TableInfos = dict[TableKey, tuple[_TableInfo, ...]]


class _ColumnAccessAnalyzer:
    def __init__(
        self,
        expression: exp.Query,
        table_infos: TableInfos,
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
                star_outputs = self._star_outputs(scope, select)
                for output in star_outputs:
                    excluded.update(origin for origin in output.origins if self._is_excluded(origin))
            if excluded:
                return excluded
        return excluded

    def _star_outputs(self, scope: Scope, select: exp.Expr) -> list[_OutputColumn]:
        star = _star_expression(select)
        if star.args.get("replace") or star.args.get("rename"):
            raise _blocked("SELECT * REPLACE/RENAME cannot be resolved safely")

        excluded_names = _star_excluded_names(star)
        outputs = self._expanded_star_outputs(scope, select)
        return [output for output in outputs if output.name.casefold() not in excluded_names]

    def _expanded_star_outputs(self, scope: Scope, select: exp.Expr) -> list[_OutputColumn]:
        if isinstance(select, exp.Column):
            source_alias = select.table
            source = scope.sources.get(source_alias)
            if source is None:
                raise _blocked(f"qualified star {source_alias}.* could not be resolved")
            return self._source_outputs(source)

        outputs: list[_OutputColumn] = []
        for _, source in scope.selected_sources.values():
            outputs.extend(self._source_outputs(source))
        return outputs

    def _source_outputs(self, source: exp.Expr | Scope) -> list[_OutputColumn]:
        if isinstance(source, exp.Table):
            outputs: dict[str, _OutputColumn] = {}
            for info in self._table_infos(source):
                for column in info.columns:
                    normalized = column.casefold()
                    origin = _ColumnOrigin(info.schema, info.table, column)
                    existing = outputs.get(normalized)
                    origins = set(existing.origins) if existing else set()
                    origins.add(origin)
                    outputs[normalized] = _OutputColumn(column, frozenset(origins))
            return list(outputs.values())
        if isinstance(source, Scope):
            if _is_unnest_scope(source):
                return []
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
                outputs.extend(self._star_outputs(scope, select))
                continue
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
            return self._resolve_unqualified_column(scope, column.name)
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
            return self._table_column_origins(source, column.name)
        if isinstance(source, Scope):
            if _is_unnest_scope(source):
                return set()
            return self._resolve_scope_output(source, column.name)
        raise _blocked(f"column source type {type(source).__name__} cannot be resolved safely")

    def _resolve_unqualified_column(self, scope: Scope, column_name: str) -> set[_ColumnOrigin]:
        origins: set[_ColumnOrigin] = set()
        has_unnest_source = False
        for _, source in scope.selected_sources.values():
            if isinstance(source, exp.Table):
                origins.update(self._table_column_origins(source, column_name))
            elif isinstance(source, Scope):
                if _is_unnest_scope(source):
                    has_unnest_source = True
                else:
                    origins.update(self._matching_scope_output_origins(source, column_name))
        if origins or has_unnest_source:
            return origins
        raise _blocked(f"column '{column_name}' could not be tied to a source")

    def _table_column_origins(self, table: exp.Table, column_name: str) -> set[_ColumnOrigin]:
        origins = set()
        for info in self._table_infos(table):
            actual_column = _match_identifier(column_name, list(info.columns)) or column_name
            origins.add(_ColumnOrigin(info.schema, info.table, actual_column))
        return origins

    def _matching_scope_output_origins(self, scope: Scope, column_name: str) -> set[_ColumnOrigin]:
        outputs = self._scope_outputs(scope)
        matches = [output for output in outputs if output.name.casefold() == column_name.casefold()]
        return set().union(*(match.origins for match in matches)) if matches else set()

    def _resolve_scope_output(self, scope: Scope, column_name: str) -> set[_ColumnOrigin]:
        outputs = self._scope_outputs(scope)
        matches = [output for output in outputs if output.name.casefold() == column_name.casefold()]
        if len(matches) != 1:
            raise _blocked(f"derived column '{column_name}' could not be resolved unambiguously")
        return set(matches[0].origins)

    def _table_infos(self, table: exp.Table) -> tuple[_TableInfo, ...]:
        infos = self.table_infos.get(_table_key(table))
        if infos is None:
            raise _blocked(f"table {table.sql()} was not resolved against the live schema")
        return infos

    def _is_excluded(self, origin: _ColumnOrigin) -> bool:
        return not self.db_config.column_matches_pattern(origin.schema, origin.table, origin.column)


def _is_unnest_scope(scope: Scope) -> bool:
    return isinstance(scope.expression, exp.Unnest)


def _match_identifier(requested: str, available: list[str]) -> str | None:
    if requested in available:
        return requested
    matches = [value for value in available if value.casefold() == requested.casefold()]
    return matches[0] if len(matches) == 1 else None


def _table_key(table: exp.Table) -> TableKey:
    return (table.catalog.casefold(), table.db.casefold(), table.name.casefold())


def _star_expression(expression: exp.Expr) -> exp.Star:
    if isinstance(expression, exp.Star):
        return expression
    if isinstance(expression, exp.Column) and isinstance(expression.this, exp.Star):
        return expression.this
    raise _blocked("star expression could not be resolved")


def _star_excluded_names(star: exp.Star) -> set[str]:
    names: set[str] = set()
    for item in star.args.get("except_") or []:
        if not isinstance(item, exp.Column) or len(item.parts) != 1 or not item.name:
            raise _blocked("qualified or nested SELECT * exclusions cannot be resolved safely")
        names.add(item.name.casefold())
    return names


def _blocked(reason: str) -> ColumnAccessError:
    return ColumnAccessError(f"Query blocked because exclude_columns could not safely validate it: {reason}")
