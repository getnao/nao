"""dbt Charts execution-layer plugins that route board queries through a nao connection.

This module imports dbt Charts at import time; `board.py` only loads it once availability is confirmed.
"""

from __future__ import annotations

import threading
from pathlib import Path
from typing import Any, Callable

from dbt_charts.cli.filesystem_project import FilesystemProject
from dbt_charts.core.compile.models.query.normalized import AnyQuery, is_sql_query
from dbt_charts.core.compile.models.source import DbtTargetSourceConfig, ResolvedSourceConfig
from dbt_charts.core.dialects import SQLDialect, get_dialect
from dbt_charts.core.execute.adapters import AdapterRegistry, ValuesAdapter
from dbt_charts.core.execute.adapters.base import (
    BaseAdapter,
    QueryParams,
    QueryResult,
    apply_row_limit_truncation,
    handle_adapter_error,
    resolve_effective_row_limit,
)
from dbt_charts.core.execute.sql_literals import INLINE_PLACEHOLDERS, inline_params_for_dialect

SqlRunner = Callable[[str, str], tuple[list[str], list[dict[str, Any]]]]
"""Executes `sql` against the nao database named by the first argument, returning (columns, rows)."""

_NAO_TYPE_TO_DIALECT = {
    "fabric": "mssql",
    "starrocks": "mysql",
    "clickhouse": "postgres",
}


def build_nao_adapter_registry(
    databases: dict[str, str],
    run_sql: SqlRunner,
    dbt_project_dir: Path | None,
) -> AdapterRegistry:
    """An adapter registry whose only SQL backend is the nao connection.

    The registry's project is rooted at the dbt project (when there is one) so dbt Charts resolves
    `{{ ref() }}` / `{{ source() }}` against its `target/manifest.json`.
    """
    project = FilesystemProject(dbt_project_dir) if dbt_project_dir is not None else None
    registry = AdapterRegistry(project=project, resolver=NaoSourceResolver(databases))  # type: ignore[arg-type]
    registry.register(NaoAdapter(run_sql))
    registry.register(ValuesAdapter())
    return registry


def dialect_for_nao_type(nao_type: str) -> str:
    return _NAO_TYPE_TO_DIALECT.get(nao_type, nao_type)


class NaoSourceConfig(DbtTargetSourceConfig):
    """A resolved source pointing at a nao database; `type` carries the SQL dialect."""

    nao_database: str


class NaoSourceResolver:
    """Maps a board's `source:` name onto a nao database instead of a dbt profile."""

    def __init__(self, databases: dict[str, str]) -> None:
        self._databases = databases

    def resolve(
        self,
        authored: Any,
        board_sources: dict[str, dict[str, Any]],
        project_sources: Any,
        dbt_context: Any,
        query_name: str = "ad-hoc query",
    ) -> ResolvedSourceConfig | None:
        if authored is None:
            return None
        if isinstance(authored, DbtTargetSourceConfig):
            return authored
        if not isinstance(authored, str) or authored not in self._databases:
            available = ", ".join(sorted(self._databases)) or "none"
            raise ValueError(
                f"Query '{query_name}': source {authored!r} is not a nao database. "
                f"Available databases: {available}. Set `source:` to one of them or drop it to use the default."
            )
        return NaoSourceConfig(type=dialect_for_nao_type(self._databases[authored]), nao_database=authored)


class NaoAdapter(BaseAdapter):
    """Receives fully rendered SQL from dbt Charts and runs it through the nao connection."""

    def __init__(self, run_sql: SqlRunner) -> None:
        self._run_sql = run_sql
        self._lock = threading.Lock()

    @property
    def supported_types(self) -> set[str]:
        return {"sql"}

    def _can_execute(self, query: AnyQuery, source_config: ResolvedSourceConfig | None) -> bool:
        return isinstance(source_config, NaoSourceConfig)

    def param_render_dialect(self, source_config: ResolvedSourceConfig) -> SQLDialect:
        return INLINE_PLACEHOLDERS

    def _execute(
        self,
        query: AnyQuery,
        variables: Any = None,
        params: QueryParams = None,
        source_config: ResolvedSourceConfig | None = None,
    ) -> QueryResult:
        if not is_sql_query(query) or not isinstance(source_config, NaoSourceConfig):
            return QueryResult(data=[], error=f"Expected a SQL query with a nao source, got {query.query_type}")
        database_name = source_config.nao_database
        sql = query.sql
        if params:
            sql = inline_params_for_dialect(sql, params, INLINE_PLACEHOLDERS, get_dialect(source_config.type))
        try:
            with self._lock:
                columns, rows = self._run_sql(database_name, sql)
        except Exception as error:  # noqa: BLE001
            return handle_adapter_error(f"nao SQL execution on '{database_name}'", error)
        limited_rows, truncated_reason = apply_row_limit_truncation(rows, resolve_effective_row_limit(query.limit))
        return QueryResult(data=limited_rows, columns=columns, truncated_reason=truncated_reason)
