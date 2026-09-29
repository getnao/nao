from pathlib import Path
from typing import cast

import pytest

from nao_core.commands.migrate.tableau.workbook import (
    chart_orientation,
    parse_field_reference,
    parse_workbook,
    source_chart_type,
)

FIXTURES = Path(__file__).parent / "fixtures"


def test_parse_workbook_reads_dashboard_layout_and_visualizations() -> None:
    workbook = parse_workbook(FIXTURES / "dashboard.twb")

    assert workbook["worksheets"] == ["Sales Trend", "Sales by Region"]
    assert workbook["skipped_worksheets"] == []
    assert workbook["warnings"] == []
    assert workbook["dashboards"] == [
        {
            "name": "Overview",
            "width": 1200,
            "height": 800,
            "background_color": "#ffffff",
            "worksheets": ["Sales Trend", "Sales by Region"],
            "layout_rows": [["Sales Trend", "Sales by Region"]],
            "zones": [
                {
                    "id": "1",
                    "type": "layout-flow",
                    "x": 0,
                    "y": 0,
                    "width": 1200,
                    "height": 800,
                    "flow_direction": "horizontal",
                },
                {
                    "id": "2",
                    "parent_id": "1",
                    "type": "worksheet",
                    "name": "Sales Trend",
                    "worksheet": "Sales Trend",
                    "x": 0,
                    "y": 0,
                    "width": 500,
                    "height": 800,
                },
                {
                    "id": "3",
                    "parent_id": "1",
                    "type": "worksheet",
                    "name": "Sales by Region",
                    "worksheet": "Sales by Region",
                    "x": 500,
                    "y": 0,
                    "width": 700,
                    "height": 800,
                },
                {
                    "id": "4",
                    "type": "filter",
                    "name": "Sales Trend",
                    "x": 0,
                    "y": 0,
                    "width": 200,
                    "height": 100,
                },
            ],
            "controls": [
                {
                    "type": "filter",
                    "field": "[sales].[none:Region:nk]",
                    "worksheet": "Sales Trend",
                }
            ],
        }
    ]

    visualizations = {
        visualization["worksheet"]: visualization
        for visualization in cast(list[dict[str, object]], workbook["worksheet_visualizations"])
    }
    assert visualizations["Sales Trend"]["source_chart_type"] == "line"
    assert visualizations["Sales by Region"]["source_chart_type"] == "bar"
    assert visualizations["Sales by Region"]["orientation"] == "vertical"


@pytest.mark.parametrize(
    ("mark_types", "rows", "columns", "encodings", "expected"),
    [
        (["Line"], [], [], [], "line"),
        (["Bar"], [{"field": "[sales].[sum:Sales:qk]", "aggregation": "sum"}], [], [], "bar"),
        (
            ["Circle"],
            [{"field": "[sales].[sum:Sales:qk]"}],
            [{"field": "[sales].[avg:Discount:qk]"}],
            [],
            "scatter",
        ),
        (["Map"], [], [], [], "map"),
        (["Text"], [], [], [{"channel": "text"}], "table"),
    ],
)
def test_source_chart_type(
    mark_types: list[str],
    rows: list[dict[str, object]],
    columns: list[dict[str, object]],
    encodings: list[dict[str, object]],
    expected: str,
) -> None:
    assert source_chart_type(mark_types, rows, columns, encodings) == expected


def test_outer_aggregate_is_preserved_for_chart_orientation() -> None:
    measure = parse_field_reference("SUM([sales].[Revenue])")

    assert measure["aggregation"] == "SUM"
    assert chart_orientation(["bar"], [], [measure]) == "horizontal"


def test_colon_encoded_aggregate_is_preserved() -> None:
    assert parse_field_reference("[sales].[sum:Revenue:qk]")["aggregation"] == "sum"
