"""MetricFlow (dbt Semantic Layer) used as a SQL compiler only.

nao never lets MetricFlow talk to a warehouse: the compiled SQL is handed to the regular
`execute_sql` pipeline so credentials, allow-listing and column guards stay in one place.
"""

from __future__ import annotations

import datetime
import logging
from dataclasses import dataclass, field
from pathlib import Path
from typing import TYPE_CHECKING, Any

from dateutil import parser as date_parser

if TYPE_CHECKING:
    from metricflow.engine.metricflow_engine import MetricFlowEngine

    from nao_core.config.semantic_layer import SemanticLayerConfig


class SemanticLayerError(Exception):
    """A semantic query could not be compiled (unknown metric, invalid filter, unsupported dialect...)."""


class SemanticLayerUnavailableError(SemanticLayerError):
    """MetricFlow is not installed in this environment."""


METRICFLOW_INSTALL_HINT = "Install it with `pip install 'nao-core[semantic-layer]'`."

# nao database types → MetricFlow SQL renderer. Types absent here have no MetricFlow renderer.
METRICFLOW_DIALECTS: dict[str, str] = {
    "athena": "athena",
    "bigquery": "bigquery",
    "databricks": "databricks",
    "duckdb": "duckdb",
    "motherduck": "duckdb",
    "postgres": "postgres",
    "redshift": "redshift",
    "snowflake": "snowflake",
    "trino": "trino",
}

# Where `nao sync` copies the manifest so the runtime never depends on the dbt project being around.
# `.meta/` is hidden from the agent's file tools: the manifest is an engine artifact, not context.
SYNCED_MANIFEST_RELATIVE_PATH = Path(".meta") / "semantic_layer" / "semantic_manifest.json"


def runtime_manifest_path(semantic_layer: "SemanticLayerConfig", project_path: Path) -> Path:
    """Prefer the synced copy of the manifest, falling back to the configured source path."""
    synced = project_path / SYNCED_MANIFEST_RELATIVE_PATH
    if synced.is_file():
        return synced
    return semantic_layer.resolve_manifest_path(project_path)


def metricflow_dialect_for(database_type: str) -> str:
    """Map a nao database type to the MetricFlow dialect that renders SQL for it."""
    dialect = METRICFLOW_DIALECTS.get(database_type)
    if dialect is None:
        supported = ", ".join(sorted(METRICFLOW_DIALECTS))
        raise SemanticLayerError(
            f"The semantic layer cannot compile SQL for `{database_type}` databases. Supported types: {supported}."
        )
    return dialect


@dataclass(frozen=True)
class SemanticQuery:
    """A metric query expressed in semantic terms, mirroring the `mf query` flags."""

    metrics: list[str]
    group_by: list[str] = field(default_factory=list)
    where: list[str] = field(default_factory=list)
    order_by: list[str] = field(default_factory=list)
    limit: int | None = None
    start_time: str | None = None
    end_time: str | None = None


@dataclass(frozen=True)
class DimensionInfo:
    name: str
    type: str
    description: str | None
    semantic_model: str | None
    granularity: str | None


@dataclass(frozen=True)
class MetricInfo:
    name: str
    label: str | None
    description: str | None
    type: str
    expr: str | None
    input_metrics: list[str]
    semantic_models: list[str]
    dimensions: list[str]


_ENGINES: dict[tuple[Path, int, str], "MetricFlowSemanticLayer"] = {}


class MetricFlowSemanticLayer:
    """A loaded `semantic_manifest.json`, able to describe itself and compile queries for one SQL dialect."""

    def __init__(self, manifest_path: Path, dialect: str) -> None:
        self.manifest_path = manifest_path
        self.dialect = dialect
        self._engine = _build_engine(manifest_path, dialect)

    @classmethod
    def load(cls, manifest_path: Path, dialect: str) -> "MetricFlowSemanticLayer":
        """Load the manifest, reusing a cached engine until the file changes on disk."""
        resolved = manifest_path.resolve()
        if not resolved.is_file():
            raise SemanticLayerError(f"Semantic manifest not found at {resolved}. Run `nao sync` after `dbt parse`.")
        key = (resolved, resolved.stat().st_mtime_ns, dialect)
        engine = _ENGINES.get(key)
        if engine is None:
            _evict_stale_engines(resolved, dialect)
            engine = cls(resolved, dialect)
            _ENGINES[key] = engine
        return engine

    def list_metrics(self) -> list[MetricInfo]:
        metrics = [_metric_info(metric) for metric in self._engine.list_metrics()]
        return sorted(metrics, key=lambda metric: metric.name)

    def list_dimensions(self) -> list[DimensionInfo]:
        dimensions = [_dimension_info(dimension) for dimension in self._engine.list_dimensions()]
        return sorted(dimensions, key=lambda dimension: dimension.name)

    def compile(self, query: SemanticQuery) -> str:
        """Compile a semantic query to SQL without executing it."""
        from metricflow.engine.metricflow_engine import MetricFlowQueryRequest

        if not query.metrics:
            raise SemanticLayerError("A semantic query needs at least one metric.")

        request = MetricFlowQueryRequest.create(
            metric_names=list(query.metrics),
            group_by_names=list(query.group_by) or None,
            where_constraints=list(query.where) or None,
            order_by_names=list(query.order_by) or None,
            limit=query.limit,
            time_constraint_start=_parse_time(query.start_time, "start_time"),
            time_constraint_end=_parse_time(query.end_time, "end_time"),
        )
        try:
            explained = self._engine.explain(request)
        except SemanticLayerError:
            raise
        except Exception as error:
            raise SemanticLayerError(str(error)) from error
        return explained.sql_statement.without_descriptions.sql.strip()


def _evict_stale_engines(manifest_path: Path, dialect: str) -> None:
    """Drop the engines built from older versions of this manifest for this dialect, keeping other projects cached."""
    for key in [key for key in _ENGINES if key[0] == manifest_path and key[2] == dialect]:
        del _ENGINES[key]


def _build_engine(manifest_path: Path, dialect: str) -> "MetricFlowEngine":
    try:
        from metricflow.engine.metricflow_engine import MetricFlowEngine
        from metricflow_semantics.model.dbt_manifest_parser import parse_manifest_from_dbt_generated_manifest
        from metricflow_semantics.model.semantic_manifest_lookup import SemanticManifestLookup
    except ImportError as error:
        raise SemanticLayerUnavailableError(f"MetricFlow is not installed. {METRICFLOW_INSTALL_HINT}") from error

    _quiet_metricflow_logs()
    try:
        manifest = parse_manifest_from_dbt_generated_manifest(manifest_path.read_text())
        lookup = SemanticManifestLookup(manifest)
    except Exception as error:
        raise SemanticLayerError(f"Could not load semantic manifest {manifest_path}: {error}") from error
    return MetricFlowEngine(semantic_manifest_lookup=lookup, sql_client=_CompileOnlySqlClient(dialect))


class _CompileOnlySqlClient:
    """Satisfies MetricFlow's `SqlClient` protocol with a renderer only; any execution attempt is a bug."""

    def __init__(self, dialect: str) -> None:
        self.sql_engine_type, self.sql_plan_renderer = _renderer_for(dialect)

    def query(self, stmt: str, sql_bind_parameter_set: Any = None) -> Any:
        raise NotImplementedError("nao executes the compiled SQL itself")

    def execute(self, stmt: str, sql_bind_parameter_set: Any = None) -> None:
        raise NotImplementedError("nao executes the compiled SQL itself")

    def dry_run(self, stmt: str, sql_bind_parameter_set: Any = None) -> None:
        raise NotImplementedError("nao executes the compiled SQL itself")

    def close(self) -> None:
        pass

    def render_bind_parameter_key(self, bind_parameter_key: str) -> str:
        return f":{bind_parameter_key}"


def _renderer_for(dialect: str) -> tuple[Any, Any]:
    from metricflow.protocols.sql_client import SqlEngine
    from metricflow.sql.render.athena import AthenaSqlPlanRenderer
    from metricflow.sql.render.big_query import BigQuerySqlPlanRenderer
    from metricflow.sql.render.databricks import DatabricksSqlPlanRenderer
    from metricflow.sql.render.duckdb_renderer import DuckDbSqlPlanRenderer
    from metricflow.sql.render.postgres import PostgresSQLSqlPlanRenderer
    from metricflow.sql.render.redshift import RedshiftSqlPlanRenderer
    from metricflow.sql.render.snowflake import SnowflakeSqlPlanRenderer
    from metricflow.sql.render.trino import TrinoSqlPlanRenderer

    renderers = {
        "athena": (SqlEngine.ATHENA, AthenaSqlPlanRenderer),
        "bigquery": (SqlEngine.BIGQUERY, BigQuerySqlPlanRenderer),
        "databricks": (SqlEngine.DATABRICKS, DatabricksSqlPlanRenderer),
        "duckdb": (SqlEngine.DUCKDB, DuckDbSqlPlanRenderer),
        "postgres": (SqlEngine.POSTGRES, PostgresSQLSqlPlanRenderer),
        "redshift": (SqlEngine.REDSHIFT, RedshiftSqlPlanRenderer),
        "snowflake": (SqlEngine.SNOWFLAKE, SnowflakeSqlPlanRenderer),
        "trino": (SqlEngine.TRINO, TrinoSqlPlanRenderer),
    }
    if dialect not in renderers:
        raise SemanticLayerError(f"Unknown MetricFlow dialect `{dialect}`.")
    engine_type, renderer_class = renderers[dialect]
    return engine_type, renderer_class()


def _metric_info(metric: Any) -> MetricInfo:
    type_params = metric.type_params
    dimensions = sorted({dimension.granularity_free_dunder_name for dimension in metric.dimensions})
    return MetricInfo(
        name=metric.name,
        label=metric.label,
        description=metric.description,
        type=metric.type.value,
        expr=getattr(type_params, "expr", None) if metric.type.value != "simple" else None,
        input_metrics=_input_metric_names(type_params),
        semantic_models=sorted(reference.semantic_model_name for reference in metric.semantic_models),
        dimensions=dimensions,
    )


def _input_metric_names(type_params: Any) -> list[str]:
    inputs = list(getattr(type_params, "metrics", None) or [])
    for attribute in ("numerator", "denominator"):
        metric_input = getattr(type_params, attribute, None)
        if metric_input is not None:
            inputs.append(metric_input)
    return [metric_input.name for metric_input in inputs]


def _dimension_info(dimension: Any) -> DimensionInfo:
    granularity = None
    if dimension.type_params is not None and dimension.type_params.time_granularity is not None:
        granularity = dimension.type_params.time_granularity.value
    reference = dimension.semantic_model_reference
    return DimensionInfo(
        name=dimension.granularity_free_dunder_name,
        type=dimension.type.value,
        description=dimension.description,
        semantic_model=reference.semantic_model_name if reference is not None else None,
        granularity=granularity,
    )


def _parse_time(value: str | None, name: str) -> datetime.datetime | None:
    if value is None or value.strip() == "":
        return None
    try:
        return date_parser.parse(value)
    except (ValueError, OverflowError) as error:
        raise SemanticLayerError(f"Invalid {name} `{value}`: use an ISO date such as 2024-01-31.") from error


def _quiet_metricflow_logs() -> None:
    for name in ("metricflow", "metricflow_semantics", "metricflow_semantic_interfaces"):
        logging.getLogger(name).setLevel(logging.ERROR)
