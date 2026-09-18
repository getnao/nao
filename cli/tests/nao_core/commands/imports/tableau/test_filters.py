from typing import cast

from nao_core.commands.imports.tableau.filters import parse_filters

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
    definition = parse_filters(WORKBOOK)
    controls = cast(list[dict[str, object]], definition["controls"])
    mappings = cast(list[dict[str, object]], definition["worksheet_mappings"])

    assert controls == [
        {
            "id": "overview_region",
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
        ["overview_region"],
        ["overview_region"],
    ]
