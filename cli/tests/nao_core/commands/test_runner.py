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
    assert msg in {"match", "match (approximate)"}
    assert comparison is None
