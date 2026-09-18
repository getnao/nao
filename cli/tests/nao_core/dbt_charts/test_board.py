import json
from pathlib import Path

import pytest

from nao_core.dbt_charts import (
    DbtChartsUnavailableError,
    find_dbt_project_dir,
    font_file_path,
    is_available,
    render_board,
    validate_board,
)

requires_dbt_charts = pytest.mark.skipif(not is_available(), reason="dbt-charts is not installed")

BOARD = """
title: Orders
variables:
  status:
    input: select
    options:
      static: [completed, returned]
queries:
  by_month: |
    SELECT month, orders FROM {{ ref('orders') }} WHERE {{ filter('status', status) }}
charts:
  trend:
    type: line
    query: by_month
    x: month
    y: orders
"""

ROWS = [
    {"month": "2024-01-01", "orders": 3},
    {"month": "2024-02-01", "orders": 5},
]


class RecordingRunner:
    def __init__(self, rows=ROWS) -> None:
        self.calls: list[tuple[str, str]] = []
        self.rows = rows

    def __call__(self, database_name: str, sql: str):
        self.calls.append((database_name, sql))
        columns = list(self.rows[0]) if self.rows else []
        return columns, self.rows


@pytest.fixture
def dbt_project(tmp_path: Path) -> Path:
    manifest = {
        "metadata": {"adapter_type": "duckdb"},
        "nodes": {
            "model.shop.orders": {
                "resource_type": "model",
                "name": "orders",
                "package_name": "shop",
                "database": "shop",
                "schema": "main",
                "alias": "orders",
                "relation_name": '"shop"."main"."orders"',
            }
        },
        "sources": {},
    }
    target = tmp_path / "dbt" / "target"
    target.mkdir(parents=True)
    (target / "manifest.json").write_text(json.dumps(manifest))
    return tmp_path / "dbt"


def test_find_dbt_project_dir_prefers_repos_then_project_subfolders(tmp_path: Path, dbt_project: Path):
    assert find_dbt_project_dir(tmp_path, []) == dbt_project
    assert find_dbt_project_dir(tmp_path, [dbt_project]) == dbt_project
    assert find_dbt_project_dir(tmp_path / "elsewhere", []) is None


@requires_dbt_charts
def test_validate_board_reports_title_and_success():
    result = validate_board(BOARD, default_database="warehouse")
    assert result.success is True
    assert result.title == "Orders"
    assert result.errors == []


@requires_dbt_charts
def test_validate_board_reports_errors():
    result = validate_board(
        "charts:\n  c:\n    type: bar\n    query: missing\n    x: a\n    y: b\n", default_database=None
    )
    assert result.success is False
    assert result.errors
    assert result.errors[0].level == "error"


@requires_dbt_charts
def test_render_board_routes_rendered_sql_through_runner(tmp_path: Path, dbt_project: Path):
    runner = RecordingRunner()
    result = render_board(
        BOARD,
        databases={"warehouse": "duckdb"},
        default_database="warehouse",
        run_sql=runner,
        variables={"status": "completed"},
        dbt_project_dir=dbt_project,
        font_url_prefix="/fonts",
    )

    assert result.board_error is None
    assert result.chart_errors == []
    assert result.svg is not None and result.svg.lstrip().startswith("<svg")
    assert result.variables == {"status": "completed"}

    [(database_name, sql)] = runner.calls
    assert database_name == "warehouse"
    assert '"shop"."main"."orders"' in sql
    assert "status = 'completed'" in sql
    assert "{{" not in sql

    [control] = result.controls
    assert control.name == "status"
    assert control.input == "select"
    assert control.options == ["completed", "returned"]


@requires_dbt_charts
def test_render_board_rejects_unknown_source():
    runner = RecordingRunner()
    board = BOARD.replace(
        "  by_month: |\n    SELECT",
        "  by_month:\n    source: nope\n    sql: SELECT",
    )
    result = render_board(board, databases={"warehouse": "duckdb"}, default_database="warehouse", run_sql=runner)
    assert runner.calls == []
    assert result.board_error is not None or result.chart_errors


@requires_dbt_charts
def test_render_board_turns_runner_failures_into_chart_errors():
    def failing_runner(database_name: str, sql: str):
        raise RuntimeError("blocked by guard")

    result = render_board(
        BOARD.replace("{{ ref('orders') }}", "orders"),
        databases={"warehouse": "duckdb"},
        default_database="warehouse",
        run_sql=failing_runner,
    )
    assert result.board_error is None
    assert len(result.chart_errors) == 1
    assert "blocked by guard" in result.chart_errors[0].message


@requires_dbt_charts
def test_font_file_path_only_serves_bundled_fonts():
    bundled = font_file_path("DBTSansTabular-Regular.woff2")
    assert bundled is not None and bundled.is_file()
    assert font_file_path("../pyproject.toml") is None
    assert font_file_path("missing.woff2") is None


def test_unavailable_error_mentions_the_extra():
    assert "nao-core[dbt-charts]" in str(DbtChartsUnavailableError())
