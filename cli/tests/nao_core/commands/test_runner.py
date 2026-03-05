from nao_core.commands.test.client import VerificationResult
from nao_core.commands.test.runner import check_dataframe


def test_check_dataframe_rounds_to_two_decimals():
    verification = VerificationResult(
        data=[{"value": 1.234, "label": "a"}],
        expectedData=[{"value": 1.231, "label": "a"}],
        expectedColumns=["value", "label"],
    )

    passed, msg, comparison = check_dataframe(verification)

    assert passed is True
    assert msg == "match"
    assert comparison is None


def test_check_dataframe_ignores_row_order():
    verification = VerificationResult(
        data=[
            {"id": 2, "value": 20.001},
            {"id": 1, "value": 10.009},
        ],
        expectedData=[
            {"id": 1, "value": 10.01},
            {"id": 2, "value": 20.0},
        ],
        expectedColumns=["id", "value"],
    )

    passed, msg, comparison = check_dataframe(verification)

    assert passed is True
    assert msg == "match"
    assert comparison is None
