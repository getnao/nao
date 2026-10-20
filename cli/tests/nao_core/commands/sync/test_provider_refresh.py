from pathlib import Path
from unittest.mock import MagicMock, patch

from nao_core.commands.sync.markers import with_generated_marker
from nao_core.commands.sync.providers.databases.provider import sync_database
from nao_core.config.databases.base import (
    DatabaseTemplate,
    ProfilingConfig,
    ProfilingRefreshPolicy,
    RefreshConfig,
)


def create_sync_setup(profiling_policy, summary_policy):
    config = MagicMock()
    config.name = "test-db"
    config.type = "duckdb"
    config.templates = [DatabaseTemplate.PROFILING, DatabaseTemplate.AI_SUMMARY]
    config.exclude_columns = []
    config.query_history_days = None
    config.profiling = ProfilingConfig(refresh_policy=profiling_policy)
    config.ai_summary = RefreshConfig(refresh_policy=summary_policy)
    config.get_database_name.return_value = "analytics"
    config.get_schemas.return_value = ["main"]
    config.matches_pattern.return_value = True
    config.get_semantic_views.return_value = []

    connection = config.connect.return_value
    connection.list_tables.return_value = ["orders"]

    context = config.create_context.return_value
    profiling_data = {
        "computed_at": "2026-07-15T12:00:00+00:00",
        "clustering_columns": [],
        "columns": [{"name": "id", "distinct_count": 10}],
    }
    context.profiling.return_value = profiling_data

    engine = MagicMock()
    engine.list_templates.return_value = [
        "databases/profiling.md.j2",
        "databases/ai_summary.md.j2",
    ]
    engine.render.side_effect = lambda template_name, **_kwargs: f"rendered {Path(template_name).stem}"

    return config, context, engine, profiling_data


def table_path(tmp_path):
    return tmp_path / "type=duckdb" / "database=analytics" / "schema=main" / "table=orders"


def run_sync(config, engine, tmp_path):
    progress = MagicMock()
    progress.add_task.return_value = "task"
    with (
        patch(
            "nao_core.commands.sync.providers.databases.provider.get_template_engine",
            return_value=engine,
        ),
        patch("nao_core.commands.sync.providers.databases.provider.UI._console"),
    ):
        sync_database(config, tmp_path, progress)


def test_both_templates_due_compute_profiling_once(tmp_path):
    config, context, engine, profiling_data = create_sync_setup(
        ProfilingRefreshPolicy.ALWAYS,
        ProfilingRefreshPolicy.ALWAYS,
    )

    run_sync(config, engine, tmp_path)

    context.profiling.assert_called_once_with()
    assert engine.render.call_count == 2
    for call in engine.render.call_args_list:
        assert call.kwargs["profiling"] is profiling_data


def test_ai_summary_refresh_does_not_rewrite_frozen_profiling(tmp_path):
    config, context, engine, profiling_data = create_sync_setup(
        ProfilingRefreshPolicy.ONCE,
        ProfilingRefreshPolicy.ALWAYS,
    )
    output_path = table_path(tmp_path)
    output_path.mkdir(parents=True)
    profiling_file = output_path / "profiling.md"
    profiling_file.write_text("frozen profiling")

    run_sync(config, engine, tmp_path)

    context.profiling.assert_called_once_with()
    assert profiling_file.read_text() == "frozen profiling"
    assert (output_path / "ai_summary.md").read_text() == with_generated_marker("rendered ai_summary.md")
    engine.render.assert_called_once()
    assert engine.render.call_args.kwargs["profiling"] is profiling_data


def test_neither_template_due_skips_profiling_compute(tmp_path):
    config, context, engine, _ = create_sync_setup(
        ProfilingRefreshPolicy.ONCE,
        ProfilingRefreshPolicy.ONCE,
    )
    output_path = table_path(tmp_path)
    output_path.mkdir(parents=True)
    (output_path / "profiling.md").write_text("frozen profiling")
    (output_path / "ai_summary.md").write_text("frozen summary")

    run_sync(config, engine, tmp_path)

    context.profiling.assert_not_called()
    engine.render.assert_not_called()


def test_failed_render_keeps_previous_file(tmp_path):
    config, _, engine, _ = create_sync_setup(
        ProfilingRefreshPolicy.ALWAYS,
        ProfilingRefreshPolicy.ALWAYS,
    )
    output_path = table_path(tmp_path)
    output_path.mkdir(parents=True)
    summary_file = output_path / "ai_summary.md"
    summary_file.write_text("previous summary")
    engine.render.side_effect = _fail_ai_summary

    run_sync(config, engine, tmp_path)

    assert summary_file.read_text() == "previous summary"
    assert (output_path / "profiling.md").read_text() == with_generated_marker("rendered profiling.md")


def test_failed_render_writes_placeholder_without_error_dump(tmp_path):
    config, _, engine, _ = create_sync_setup(
        ProfilingRefreshPolicy.ALWAYS,
        ProfilingRefreshPolicy.ALWAYS,
    )
    engine.render.side_effect = _fail_ai_summary

    run_sync(config, engine, tmp_path)

    content = (table_path(tmp_path) / "ai_summary.md").read_text()
    assert "ai_summary not generated: prompt is too long" in content
    assert "Error generating content" not in content
    assert "stack trace details" not in content


def _fail_ai_summary(template_name, **_kwargs):
    if "ai_summary" in template_name:
        raise RuntimeError("prompt is too long: 1109582 tokens > 1000000 maximum\nstack trace details")
    return f"rendered {Path(template_name).stem}"
