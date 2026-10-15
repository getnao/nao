import pytest

from nao_core.commands.test.compare import normalize_formatted_number


@pytest.mark.parametrize(
    ("value", "expected"),
    [
        ("52,123,123", 52123123.0),
        ("1,234.56", 1234.56),
        ("  9,999  ", 9999.0),
        ("-1,000", -1000.0),
        ("1.234.567,89", 1234567.89),
        ("1.234.567", 1234567.0),
        (52123123, 52123123),
        ("not a number", "not a number"),
        ("", ""),
    ],
)
def test_normalize_formatted_number(value, expected):
    assert normalize_formatted_number(value) == expected
