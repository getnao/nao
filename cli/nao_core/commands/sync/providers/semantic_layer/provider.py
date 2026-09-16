"""Semantic layer sync provider: copies the engine artifact and documents every metric and dimension."""

import json
import shutil
from pathlib import Path
from typing import Any

from rich.markup import escape

from nao_core.config import NaoConfig
from nao_core.config.semantic_layer import SemanticLayerConfig
from nao_core.semantic_layer import (
    METRICFLOW_DIALECTS,
    SYNCED_MANIFEST_RELATIVE_PATH,
    DimensionInfo,
    MetricFlowSemanticLayer,
    MetricInfo,
    SemanticLayerError,
)
from nao_core.ui import UI

from ..base import SyncProvider, SyncResult

METRICS_DIR = "metrics"
DIMENSIONS_FILENAME = "dimensions.md"
README_FILENAME = "README.md"


class SemanticLayerSyncProvider(SyncProvider):
    """Provider for syncing the semantic layer definitions into `semantics/`."""

    @property
    def name(self) -> str:
        return "Semantic layer"

    @property
    def emoji(self) -> str:
        return "📐"

    @property
    def default_output_dir(self) -> str:
        return "semantics"

    def get_items(self, config: NaoConfig) -> list[SemanticLayerConfig]:
        return [config.semantic_layer] if config.semantic_layer else []

    def sync(
        self,
        items: list[Any],
        output_path: Path,
        project_path: Path | None = None,
        *,
        threads: int = 1,
    ) -> SyncResult:
        if not items:
            return SyncResult(provider_name=self.name, items_synced=0)

        semantic_layer: SemanticLayerConfig = items[0]
        base_path = project_path or Path.cwd()

        UI.print(f"\n[bold cyan]{self.emoji} Syncing {self.name}[/bold cyan]")
        UI.print(f"[dim]Location:[/dim] {output_path.absolute()}\n")

        try:
            metrics, dimensions = sync_semantic_layer(semantic_layer, base_path, output_path)
        except SemanticLayerError as error:
            UI.print(f"  [yellow]⚠[/yellow] {escape(str(error))}")
            return SyncResult(provider_name=self.name, items_synced=0, error=str(error))

        UI.print(f"  [green]✓[/green] {len(metrics)} metrics, {len(dimensions)} dimensions")
        return SyncResult(
            provider_name=self.name,
            items_synced=len(metrics),
            summary=f"{len(metrics)} metrics, {len(dimensions)} dimensions",
        )


def sync_semantic_layer(
    semantic_layer: SemanticLayerConfig,
    project_path: Path,
    output_path: Path,
) -> tuple[list[MetricInfo], list[DimensionInfo]]:
    """Copy the manifest under `.meta/` and regenerate the metric and dimension docs."""
    source_manifest = semantic_layer.resolve_manifest_path(project_path)
    if not source_manifest.is_file():
        raise SemanticLayerError(
            f"Semantic manifest not found at {source_manifest}. Run `dbt parse` and check `semantic_layer.manifest_path`."
        )

    output_path.mkdir(parents=True, exist_ok=True)
    manifest_copy = project_path / SYNCED_MANIFEST_RELATIVE_PATH
    manifest_copy.parent.mkdir(parents=True, exist_ok=True)
    if source_manifest.resolve() != manifest_copy.resolve():
        shutil.copy2(source_manifest, manifest_copy)

    engine = MetricFlowSemanticLayer.load(manifest_copy, _docs_dialect(semantic_layer))
    metrics = engine.list_metrics()
    dimensions = engine.list_dimensions()

    _write_metric_docs(output_path / METRICS_DIR, metrics)
    (output_path / DIMENSIONS_FILENAME).write_text(render_dimensions_index(dimensions))
    (output_path / README_FILENAME).write_text(render_readme(semantic_layer, len(metrics), len(dimensions)))
    return metrics, dimensions


def _docs_dialect(semantic_layer: SemanticLayerConfig) -> str:
    """Listing metrics does not render SQL, so any dialect works; DuckDB is always available."""
    return METRICFLOW_DIALECTS["duckdb"]


def _write_metric_docs(metrics_dir: Path, metrics: list[MetricInfo]) -> None:
    if metrics_dir.exists():
        shutil.rmtree(metrics_dir)
    metrics_dir.mkdir(parents=True)
    for metric in metrics:
        (metrics_dir / f"{metric.name}.md").write_text(render_metric_doc(metric))


def render_metric_doc(metric: MetricInfo) -> str:
    lines = [f"# {metric.name}", ""]
    if metric.label and metric.label != metric.name:
        lines.append(f"**Label:** {metric.label}  ")
    lines.append(f"**Type:** {metric.type}  ")
    if metric.description:
        lines.append(f"**Description:** {metric.description}  ")
    if metric.expr:
        lines.append(f"**Expression:** `{metric.expr}`  ")
    if metric.input_metrics:
        lines.append(f"**Input metrics:** {', '.join(f'`{name}`' for name in metric.input_metrics)}  ")
    if metric.semantic_models:
        lines.append(f"**Semantic models:** {', '.join(f'`{name}`' for name in metric.semantic_models)}  ")

    lines += ["", "## Dimensions", ""]
    lines.append(
        "Group by or filter this metric with any of the dimensions below. `metric_time` accepts a granularity "
        "suffix: `metric_time__day`, `metric_time__week`, `metric_time__month`, `metric_time__quarter`, "
        "`metric_time__year`."
    )
    lines.append("")
    lines += [f"- `{dimension}`" for dimension in metric.dimensions]

    lines += ["", "## Query", ""]
    lines.append("Over time:")
    lines.append("```json")
    lines.append(
        f'{{"metrics": ["{metric.name}"], "group_by": ["metric_time__month"], "order_by": ["metric_time__month"]}}'
    )
    lines.append("```")
    lines.append("")
    lines.append("Broken down, filtered and ranked (see `../README.md` for every parameter):")
    lines.append("```json")
    lines.append(json.dumps(_filtered_query_example(metric)))
    lines.append("```")
    return "\n".join(lines) + "\n"


def _filtered_query_example(metric: MetricInfo) -> dict[str, Any]:
    """A query using one of the metric's own dimensions, so the example is copy-pasteable."""
    dimension = next((name for name in metric.dimensions if name != "metric_time"), None)
    if dimension is None:
        return {
            "metrics": [metric.name],
            "where": ["{{ TimeDimension('metric_time', 'day') }} >= '2024-01-01'"],
            "order_by": [f"-{metric.name}"],
            "limit": 10,
        }
    return {
        "metrics": [metric.name],
        "group_by": [dimension],
        "where": [f"{{{{ Dimension('{dimension}') }}}} IS NOT NULL"],
        "order_by": [f"-{metric.name}"],
        "limit": 10,
        "start_time": "2024-01-01",
        "end_time": "2024-12-31",
    }


def render_dimensions_index(dimensions: list[DimensionInfo]) -> str:
    lines = [
        "# Dimensions",
        "",
        "Every dimension exposed by the semantic layer, named `entity__dimension` as expected by "
        "`execute_semantic_query`. Time dimensions accept a granularity suffix (e.g. `booking__ds__month`).",
        "",
        "| Dimension | Type | Granularity | Semantic model | Description |",
        "| --- | --- | --- | --- | --- |",
    ]
    for dimension in dimensions:
        lines.append(
            "| "
            + " | ".join(
                [
                    f"`{dimension.name}`",
                    dimension.type,
                    dimension.granularity or "",
                    f"`{dimension.semantic_model}`" if dimension.semantic_model else "",
                    _escape_table_cell(dimension.description),
                ]
            )
            + " |"
        )
    return "\n".join(lines) + "\n"


def render_readme(semantic_layer: SemanticLayerConfig, metric_count: int, dimension_count: int) -> str:
    return (
        "# Semantic layer\n"
        "\n"
        f"Synced from the {semantic_layer.type.value} manifest at `{semantic_layer.manifest_path}` by `nao sync`. "
        "Do not edit generated files, they are rewritten on every sync.\n"
        "\n"
        f"- `{METRICS_DIR}/<metric>.md` — one file per metric ({metric_count} metrics): definition, type and the "
        "dimensions it can be grouped or filtered by.\n"
        f"- `{DIMENSIONS_FILENAME}` — index of every dimension ({dimension_count} dimensions).\n"
        "\n"
        "Query metrics with the `execute_semantic_query` tool: nao compiles the governed definition to SQL with "
        "MetricFlow and runs it on the configured database.\n"
        "\n"
        "## Query parameters\n"
        "\n"
        "| Parameter | Meaning | Example |\n"
        "| --- | --- | --- |\n"
        '| `metrics` | Metric names to compute (required, one or more). | `["revenue", "orders"]` |\n'
        "| `group_by` | Dimensions or entities to break down by, as `entity__dimension`. Time dimensions take a "
        "granularity suffix: `day`, `week`, `month`, `quarter`, `year`. `metric_time` is the metric's own time "
        'axis and works for every metric. | `["metric_time__month", "customer__region"]` |\n'
        "| `where` | SQL filters, ANDed together. Wrap every model field in a template so MetricFlow resolves the "
        "joins: `Dimension('entity__dimension')`, `TimeDimension('metric_time', 'day')`, `Entity('entity')`, "
        "`Metric('metric', group_by=['entity'])`. Bare column names are not resolved and fail. | "
        "`[\"{{ Dimension('order__status') }} = 'completed'\", \"{{ TimeDimension('metric_time', 'day') }} >= "
        "'2024-01-01'\"]` |\n"
        "| `order_by` | Metrics or `group_by` items to sort by; prefix with `-` for descending. | "
        '`["-revenue", "metric_time__month"]` |\n'
        "| `limit` | Maximum number of rows. | `10` |\n"
        "| `start_time`, `end_time` | Inclusive ISO dates bounding `metric_time`. Simpler than a `where` for plain "
        'date ranges; combine with `where` for anything else. | `"2024-01-01"`, `"2024-12-31"` |\n'
        "\n"
        "Filter on a metric to keep only entities above a threshold, e.g. customers who spent more than 100: "
        '`{"metrics": ["revenue"], "group_by": ["customer__name"], '
        "\"where\": [\"{{ Metric('revenue', group_by=['customer']) }} > 100\"]}`.\n"
        "\n"
        "Only metrics are queryable: measures are building blocks and are exposed as metrics either explicitly or "
        "with `create_metric: true` in the semantic model.\n"
    )


def _escape_table_cell(value: str | None) -> str:
    if not value:
        return ""
    return " ".join(value.split()).replace("|", "\\|")
