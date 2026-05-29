import importlib
from pathlib import Path
from unittest.mock import Mock

import pytest

from nao_core.commands.test.case import TestCase as NaoTestCase
from nao_core.commands.test.client import (
    TestResult as AgentTestResult,
)
from nao_core.commands.test.client import (
    TokenCost,
    TokenUsage,
    VerificationResult,
    serialize_model_costs,
)
from nao_core.commands.test.runner import ModelConfig, check_dataframe, filter_test_cases, run_test
from nao_core.config.llm import ModelCosts

test_runner_module = importlib.import_module("nao_core.commands.test.runner")


def test_check_dataframe_treats_comma_formatted_numbers_as_equal():
    verification = VerificationResult(
        data=[{"total": "52,123,123"}],
        expectedData=[{"total": 52123123}],
        expectedColumns=["total"],
    )

    passed, msg, comparison = check_dataframe(verification)

    assert passed is True
    assert msg in {"match", "match (approximate)"}
    assert comparison is None


def test_check_dataframe_comma_formatted_numbers_still_detect_mismatch():
    verification = VerificationResult(
        data=[{"total": "52,000,000"}],
        expectedData=[{"total": 52123123}],
        expectedColumns=["total"],
    )

    passed, msg, comparison = check_dataframe(verification)

    assert passed is False
    assert msg == "values differ"


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
        NaoTestCase(name="orders", prompt="p1", file_path=Path("tests/orders.yml"), sql="select 1"),
        NaoTestCase(name="users", prompt="p2", file_path=Path("tests/users.yml"), sql="select 1"),
    ]

    filtered = filter_test_cases(test_cases, "users")

    assert len(filtered) == 1
    assert filtered[0].name == "users"


def test_filter_test_cases_by_file_stem():
    test_cases = [
        NaoTestCase(name="orders check", prompt="p1", file_path=Path("tests/orders.yml"), sql="select 1"),
    ]

    filtered = filter_test_cases(test_cases, "orders")

    assert len(filtered) == 1
    assert filtered[0].name == "orders check"


def test_filter_test_cases_missing():
    test_cases = [
        NaoTestCase(name="orders", prompt="p1", file_path=Path("tests/orders.yml"), sql="select 1"),
    ]

    with pytest.raises(ValueError, match="Test not found: missing"):
        filter_test_cases(test_cases, "missing")


def test_filter_test_cases_comma_separated():
    test_cases = [
        NaoTestCase(name="orders", prompt="p1", file_path=Path("tests/orders.yml"), sql="select 1"),
        NaoTestCase(name="users", prompt="p2", file_path=Path("tests/users.yml"), sql="select 1"),
        NaoTestCase(name="revenue", prompt="p3", file_path=Path("tests/revenue.yml"), sql="select 1"),
    ]

    filtered = filter_test_cases(test_cases, "orders,revenue")

    assert [tc.name for tc in filtered] == ["orders", "revenue"]


def test_filter_test_cases_comma_separated_deduplicates():
    test_cases = [
        NaoTestCase(name="orders", prompt="p1", file_path=Path("tests/orders.yml"), sql="select 1"),
        NaoTestCase(name="users", prompt="p2", file_path=Path("tests/users.yml"), sql="select 1"),
    ]

    filtered = filter_test_cases(test_cases, "orders, orders ,users")

    assert [tc.name for tc in filtered] == ["orders", "users"]


def test_filter_test_cases_comma_separated_missing():
    test_cases = [
        NaoTestCase(name="orders", prompt="p1", file_path=Path("tests/orders.yml"), sql="select 1"),
    ]

    with pytest.raises(ValueError, match="Test not found: missing"):
        filter_test_cases(test_cases, "orders,missing")


def test_serialize_model_costs_uses_backend_field_names():
    costs = ModelCosts(
        input_no_cache=1.0,
        input_cache_read=0.1,
        input_cache_write=1.25,
        output=2.0,
    )

    assert serialize_model_costs(costs) == {
        "inputNoCache": 1.0,
        "inputCacheRead": 0.1,
        "inputCacheWrite": 1.25,
        "output": 2.0,
    }


def test_run_test_passes_configured_costs_to_client(monkeypatch):
    test_case = NaoTestCase(name="orders", prompt="p1", file_path=Path("tests/orders.yml"), sql="select 1")
    model = ModelConfig(provider="openai", model_id="custom-model")
    costs = ModelCosts(
        input_no_cache=1.0,
        input_cache_read=0.1,
        input_cache_write=1.25,
        output=2.0,
    )
    client = Mock()
    client.run_test.return_value = AgentTestResult(
        text="",
        tool_calls=[],
        usage=TokenUsage(totalTokens=0),
        cost=TokenCost(totalCost=0),
        finish_reason="stop",
        duration_ms=1,
    )
    monkeypatch.setattr(test_runner_module, "get_client", lambda **_: client)

    result = run_test(test_case, model, costs=costs)

    assert result.passed is True
    client.run_test.assert_called_once_with(test_case, provider="openai", model_id="custom-model", costs=costs)
