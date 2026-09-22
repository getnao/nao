from __future__ import annotations

import shutil
from pathlib import Path

from nao_core.commands.sync.providers.semantic_layer.provider import SemanticLayerSyncProvider
from nao_core.config import NaoConfig
from nao_core.config.semantic_layer import SemanticLayerConfig

FIXTURE_MANIFEST = Path(__file__).parent / "semantic_manifest.json"


def _project_with_manifest(tmp_path: Path) -> Path:
    manifest = tmp_path / "dbt" / "target" / "semantic_manifest.json"
    manifest.parent.mkdir(parents=True)
    shutil.copy(FIXTURE_MANIFEST, manifest)
    return tmp_path


def test_provider_only_syncs_when_configured() -> None:
    provider = SemanticLayerSyncProvider()

    assert provider.get_items(NaoConfig(project_name="p")) == []
    config = NaoConfig(project_name="p", semantic_layer=SemanticLayerConfig(manifest_path="m.json"))
    assert provider.get_items(config) == [config.semantic_layer]


def test_sync_writes_manifest_copy_and_docs(tmp_path: Path) -> None:
    project = _project_with_manifest(tmp_path)
    semantic_layer = SemanticLayerConfig(manifest_path="dbt/target/semantic_manifest.json")
    output = project / "semantics"
    (output / "metrics").mkdir(parents=True)
    (output / "metrics" / "stale_metric.md").write_text("old")
    (output / "my_notes.md").write_text("keep me")

    result = SemanticLayerSyncProvider().sync([semantic_layer], output, project_path=project)

    assert result.success
    assert result.items_synced == 3
    assert (project / ".meta" / "semantic_layer" / "semantic_manifest.json").read_text() == FIXTURE_MANIFEST.read_text()
    assert sorted(path.name for path in (output / "metrics").iterdir()) == [
        "average_order_value.md",
        "orders.md",
        "revenue.md",
    ]
    assert (output / "my_notes.md").read_text() == "keep me"

    revenue_doc = (output / "metrics" / "revenue.md").read_text()
    assert "# revenue" in revenue_doc
    assert "**Label:** Revenue" in revenue_doc
    assert "Total revenue from orders" in revenue_doc
    assert "- `order__status`" in revenue_doc
    assert '{"metrics": ["revenue"], "group_by": ["metric_time__month"]' in revenue_doc
    assert "{{ Dimension('order__ordered_at') }} IS NOT NULL" in revenue_doc
    assert '"order_by": ["-revenue"], "limit": 10}' in revenue_doc

    ratio_doc = (output / "metrics" / "average_order_value.md").read_text()
    assert "**Type:** ratio" in ratio_doc
    assert "**Input metrics:** `revenue`, `orders`" in ratio_doc

    dimensions_doc = (output / "dimensions.md").read_text()
    assert "| `order__status` | categorical |  | `orders` | Order status |" in dimensions_doc
    assert "| `order__ordered_at` | time | day | `orders` |  |" in dimensions_doc

    readme = (output / "README.md").read_text()
    assert "3 metrics" in readme
    for parameter in ("`metrics`", "`group_by`", "`where`", "`order_by`", "`limit`", "`start_time`, `end_time`"):
        assert f"| {parameter} |" in readme


def test_sync_keeps_last_good_manifest_when_source_is_broken(tmp_path: Path) -> None:
    project = _project_with_manifest(tmp_path)
    semantic_layer = SemanticLayerConfig(manifest_path="dbt/target/semantic_manifest.json")
    output = project / "semantics"
    SemanticLayerSyncProvider().sync([semantic_layer], output, project_path=project)
    (project / "dbt" / "target" / "semantic_manifest.json").write_text("{ not json")

    result = SemanticLayerSyncProvider().sync([semantic_layer], output, project_path=project)

    assert not result.success
    assert (project / ".meta" / "semantic_layer" / "semantic_manifest.json").read_text() == FIXTURE_MANIFEST.read_text()


def test_sync_reports_missing_manifest(tmp_path: Path) -> None:
    semantic_layer = SemanticLayerConfig(manifest_path="nowhere/semantic_manifest.json")

    result = SemanticLayerSyncProvider().sync([semantic_layer], tmp_path / "semantics", project_path=tmp_path)

    assert not result.success
    assert result.error is not None
    assert "not found" in result.error
