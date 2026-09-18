from nao_core.commands.imports.tableau.workbook import chart_orientation, parse_field_reference


def test_outer_aggregate_is_preserved_for_chart_orientation() -> None:
    measure = parse_field_reference("SUM([sales].[Revenue])")

    assert measure["aggregation"] == "SUM"
    assert chart_orientation(["bar"], [], [measure]) == "horizontal"


def test_colon_encoded_aggregate_is_preserved() -> None:
    assert parse_field_reference("[sales].[sum:Revenue:qk]")["aggregation"] == "sum"
