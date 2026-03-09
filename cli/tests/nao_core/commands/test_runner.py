from pathlib import Path

import pytest

from nao_core.commands.test.case import TestCase
from nao_core.commands.test.client import VerificationResult
from nao_core.commands.test.runner import check_dataframe, filter_test_cases


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


def test_filter_test_cases_by_name():
    test_cases = [
        TestCase(name="orders", prompt="p1", file_path=Path("tests/orders.yml"), sql="select 1"),
        TestCase(name="users", prompt="p2", file_path=Path("tests/users.yml"), sql="select 1"),
    ]

    filtered = filter_test_cases(test_cases, "users")

    assert len(filtered) == 1
    assert filtered[0].name == "users"


def test_filter_test_cases_by_file_stem():
    test_cases = [
        TestCase(name="orders check", prompt="p1", file_path=Path("tests/orders.yml"), sql="select 1"),
    ]

    filtered = filter_test_cases(test_cases, "orders")

    assert len(filtered) == 1
    assert filtered[0].name == "orders check"


def test_filter_test_cases_missing():
    test_cases = [
        TestCase(name="orders", prompt="p1", file_path=Path("tests/orders.yml"), sql="select 1"),
    ]

    with pytest.raises(ValueError, match="Test not found: missing"):
        filter_test_cases(test_cases, "missing")
