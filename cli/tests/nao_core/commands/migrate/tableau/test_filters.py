from typing import cast

import pytest

from nao_core.commands.migrate.tableau.filters import (
    control_identifier,
    extract_worksheet_mappings,
    parse_filters,
)

WORKBOOK = b"""
<workbook>
  <worksheets>
    <worksheet name="Sales by product">
      <table>
        <view>
          <filter class="categorical" column="[sales].[none:Region:nk]">
            <groupfilter function="member" member="&quot;East&quot;" />
          </filter>
        </view>
      </table>
    </worksheet>
    <worksheet name="Profit by month">
      <table>
        <view>
          <filter class="categorical" column="[sales].[none:Region:nk]">
            <groupfilter function="member" member="&quot;West&quot;" />
          </filter>
        </view>
      </table>
    </worksheet>
  </worksheets>
  <dashboards>
    <dashboard name="Overview">
      <zones>
        <zone type-v2="worksheet" name="Sales by product" />
        <zone type-v2="worksheet" name="Profit by month" />
        <zone type-v2="filter" name="Sales by product" param="[sales].[none:Region:nk]" />
      </zones>
    </dashboard>
  </dashboards>
</workbook>
"""


def test_parse_filters_builds_effective_worksheet_mappings() -> None:
    interactions = parse_filters(WORKBOOK)
    controls = cast(list[dict[str, object]], interactions["controls"])
    mappings = cast(list[dict[str, object]], interactions["worksheet_mappings"])
    region_id = control_identifier("filter", "Overview", "[sales].[none:Region:nk]")

    assert controls == [
        {
            "id": region_id,
            "type": "filter",
            "dashboard": "Overview",
            "caption": "Region",
            "field": "[sales].[none:Region:nk]",
            "source_worksheet": "Sales by product",
            "mode": "include",
            "values": ["East", "West"],
            "target_worksheets": ["Sales by product", "Profit by month"],
            "mappings": [
                {
                    "worksheet": "Sales by product",
                    "source_field": "[sales].[none:Region:nk]",
                    "data_source": "sales",
                    "mode": "include",
                    "context": False,
                },
                {
                    "worksheet": "Profit by month",
                    "source_field": "[sales].[none:Region:nk]",
                    "data_source": "sales",
                    "mode": "include",
                    "context": False,
                },
            ],
        }
    ]
    assert [mapping["effective_filter_ids"] for mapping in mappings] == [
        [region_id],
        [region_id],
    ]


def test_parse_filters_rejects_an_unknown_dashboard() -> None:
    with pytest.raises(ValueError, match='No dashboard named "Missing"'):
        parse_filters(WORKBOOK, "Missing")


def test_parse_filters_keeps_same_caption_controls_from_different_data_sources() -> None:
    workbook = b"""
    <workbook>
      <worksheets>
        <worksheet name="Sales">
          <filter class="categorical" column="[sales].[none:Region:nk]">
            <groupfilter function="member" member="&quot;East&quot;" />
          </filter>
        </worksheet>
        <worksheet name="Returns">
          <filter class="categorical" column="[returns].[none:Region:nk]">
            <groupfilter function="member" member="&quot;West&quot;" />
          </filter>
        </worksheet>
      </worksheets>
      <dashboards>
        <dashboard name="Overview">
          <zones>
            <zone type-v2="worksheet" name="Sales" />
            <zone type-v2="worksheet" name="Returns" />
            <zone type-v2="filter" name="Sales" param="[sales].[none:Region:nk]" />
            <zone type-v2="filter" name="Returns" param="[returns].[none:Region:nk]" />
          </zones>
        </dashboard>
      </dashboards>
    </workbook>
    """

    controls = cast(list[dict[str, object]], parse_filters(workbook)["controls"])

    assert [control["id"] for control in controls] == [
        control_identifier("filter", "Overview", "[sales].[none:Region:nk]"),
        control_identifier("filter", "Overview", "[returns].[none:Region:nk]"),
    ]


def test_parse_filters_keeps_fields_with_distinct_separators() -> None:
    fields = [
        "[sales].[none:North Sales:nk]",
        "[sales].[none:North-Sales:nk]",
        "[sales].[none:North_Sales:nk]",
    ]
    filters = "\n".join(
        f"""
        <filter class="categorical" column="{field}">
          <groupfilter function="member" member="&quot;Value {index}&quot;" />
        </filter>
        """
        for index, field in enumerate(fields)
    )
    controls = "\n".join(f'<zone type-v2="filter" name="Sales" param="{field}" />' for field in fields)
    workbook = f"""
    <workbook>
      <worksheets>
        <worksheet name="Sales">{filters}</worksheet>
      </worksheets>
      <dashboards>
        <dashboard name="Overview">
          <zones>
            <zone type-v2="worksheet" name="Sales" />
            {controls}
          </zones>
        </dashboard>
      </dashboards>
    </workbook>
    """.encode()

    interactions = parse_filters(workbook)
    parsed_controls = cast(list[dict[str, object]], interactions["controls"])
    mappings = cast(list[dict[str, object]], interactions["worksheet_mappings"])

    assert [control["field"] for control in parsed_controls] == fields
    assert len({str(control["id"]) for control in parsed_controls}) == 3
    assert [
        cast(list[dict[str, object]], control["mappings"])[0]["source_field"] for control in parsed_controls
    ] == fields
    assert mappings[0]["effective_filter_ids"] == [control["id"] for control in parsed_controls]


def test_control_identifier_includes_control_type() -> None:
    filter_id = control_identifier("filter", "123 Overview", "[sales].[none:Region:nk]")
    parameter_id = control_identifier("parameter", "123 Overview", "[sales].[none:Region:nk]")

    assert filter_id.startswith("filter_123_overview_sales_region_")
    assert parameter_id.startswith("parameter_123_overview_sales_region_")
    assert filter_id != parameter_id


def test_worksheet_mappings_include_all_control_types() -> None:
    mappings = extract_worksheet_mappings(
        [
            {
                "id": "filter_overview_sales_region",
                "type": "filter",
                "dashboard": "Overview",
                "mappings": [{"worksheet": "Sales", "source_field": "[sales].[none:Region:nk]"}],
            },
            {
                "id": "parameter_overview_sales_date",
                "type": "parameter",
                "dashboard": "Overview",
                "mappings": [{"worksheet": "Sales", "source_field": "[sales].[Parameters].[Date]"}],
            },
        ]
    )

    assert mappings == [
        {
            "dashboard": "Overview",
            "worksheet": "Sales",
            "effective_filter_ids": ["filter_overview_sales_region"],
            "control_mappings": [
                {
                    "control_id": "filter_overview_sales_region",
                    "type": "filter",
                    "worksheet": "Sales",
                    "source_field": "[sales].[none:Region:nk]",
                },
                {
                    "control_id": "parameter_overview_sales_date",
                    "type": "parameter",
                    "worksheet": "Sales",
                    "source_field": "[sales].[Parameters].[Date]",
                },
            ],
        }
    ]
