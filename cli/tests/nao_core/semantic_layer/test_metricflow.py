from __future__ import annotations

import shutil
from pathlib import Path

import pytest

from nao_core.config.semantic_layer import SemanticLayerConfig
from nao_core.semantic_layer import (
    MetricFlowSemanticLayer,
    SemanticLayerError,
    SemanticQuery,
    metricflow_dialect_for,
    runtime_manifest_path,
)

FIXTURE_MANIFEST = Path(__file__).parent / "semantic_manifest.json"


@pytest.fixture
def manifest_path(tmp_path: Path) -> Path:
    destination = tmp_path / "semantic_manifest.json"
    shutil.copy(FIXTURE_MANIFEST, destination)
    return destination


def test_lists_metrics_with_their_dimensions(manifest_path: Path) -> None:
    layer = MetricFlowSemanticLayer.load(manifest_path, "duckdb")

    metrics = {metric.name: metric for metric in layer.list_metrics()}

    assert set(metrics) == {"average_order_value", "orders", "revenue"}
    assert metrics["revenue"].label == "Revenue"
    assert metrics["revenue"].type == "simple"
    assert metrics["revenue"].semantic_models == ["orders"]
    assert "order__status" in metrics["revenue"].dimensions
    assert "metric_time" in metrics["revenue"].dimensions
    assert metrics["average_order_value"].type == "ratio"
    assert metrics["average_order_value"].input_metrics == ["revenue", "orders"]


def test_lists_dimensions(manifest_path: Path) -> None:
    layer = MetricFlowSemanticLayer.load(manifest_path, "duckdb")

    dimensions = {dimension.name: dimension for dimension in layer.list_dimensions()}

    assert set(dimensions) == {"order__ordered_at", "order__status"}
    assert dimensions["order__ordered_at"].type == "time"
    assert dimensions["order__ordered_at"].granularity == "day"
    assert dimensions["order__status"].description == "Order status"


def test_compiles_grouped_and_filtered_query(manifest_path: Path) -> None:
    layer = MetricFlowSemanticLayer.load(manifest_path, "duckdb")

    sql = layer.compile(
        SemanticQuery(
            metrics=["revenue", "orders"],
            group_by=["metric_time__month"],
            where=["{{ Dimension('order__status') }} = 'completed'"],
            order_by=["-metric_time__month"],
            limit=12,
            start_time="2024-01-01",
        )
    )

    assert "SUM(revenue) AS revenue" in sql
    assert "FROM main.orders" in sql
    assert "DATE_TRUNC('month', ordered_at)" in sql
    assert "order__status = 'completed'" in sql
    assert "ORDER BY metric_time__month DESC" in sql
    assert "LIMIT 12" in sql
    assert "2024-01-01" in sql
    assert "--" not in sql


def test_compiles_per_dialect(manifest_path: Path) -> None:
    duckdb_sql = MetricFlowSemanticLayer.load(manifest_path, "duckdb").compile(
        SemanticQuery(metrics=["revenue"], group_by=["metric_time__month"])
    )
    bigquery_sql = MetricFlowSemanticLayer.load(manifest_path, "bigquery").compile(
        SemanticQuery(metrics=["revenue"], group_by=["metric_time__month"])
    )

    assert "DATE_TRUNC('month', ordered_at)" in duckdb_sql
    assert "TIMESTAMP_TRUNC(ordered_at, month)" in bigquery_sql


def test_unknown_metric_reports_suggestions(manifest_path: Path) -> None:
    layer = MetricFlowSemanticLayer.load(manifest_path, "duckdb")

    with pytest.raises(SemanticLayerError, match="revenue"):
        layer.compile(SemanticQuery(metrics=["revenu"]))


def test_rejects_empty_metrics_and_bad_dates(manifest_path: Path) -> None:
    layer = MetricFlowSemanticLayer.load(manifest_path, "duckdb")

    with pytest.raises(SemanticLayerError, match="at least one metric"):
        layer.compile(SemanticQuery(metrics=[]))
    with pytest.raises(SemanticLayerError, match="start_time"):
        layer.compile(SemanticQuery(metrics=["revenue"], start_time="yesterday-ish"))


def test_reuses_engine_until_manifest_changes(manifest_path: Path) -> None:
    first = MetricFlowSemanticLayer.load(manifest_path, "duckdb")

    assert MetricFlowSemanticLayer.load(manifest_path, "duckdb") is first

    content = manifest_path.read_text()
    manifest_path.write_text(content.replace("Total revenue from orders", "Revenue, in euros"))
    stat = manifest_path.stat()
    import os

    os.utime(manifest_path, ns=(stat.st_atime_ns, stat.st_mtime_ns + 1_000_000_000))

    reloaded = MetricFlowSemanticLayer.load(manifest_path, "duckdb")

    assert reloaded is not first
    assert {metric.description for metric in reloaded.list_metrics()} >= {"Revenue, in euros"}


def test_missing_manifest(tmp_path: Path) -> None:
    with pytest.raises(SemanticLayerError, match="not found"):
        MetricFlowSemanticLayer.load(tmp_path / "missing.json", "duckdb")


def test_dialect_mapping() -> None:
    assert metricflow_dialect_for("motherduck") == "duckdb"
    assert metricflow_dialect_for("snowflake") == "snowflake"
    with pytest.raises(SemanticLayerError, match="clickhouse"):
        metricflow_dialect_for("clickhouse")


def test_runtime_manifest_prefers_synced_copy(tmp_path: Path) -> None:
    config = SemanticLayerConfig(manifest_path="dbt/target/semantic_manifest.json")

    assert runtime_manifest_path(config, tmp_path) == (tmp_path / "dbt/target/semantic_manifest.json").resolve()

    synced = tmp_path / ".meta" / "semantic_layer" / "semantic_manifest.json"
    synced.parent.mkdir(parents=True)
    synced.write_text("{}")

    assert runtime_manifest_path(config, tmp_path) == synced
