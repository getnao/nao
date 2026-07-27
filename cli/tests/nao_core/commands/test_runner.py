import importlib
from pathlib import Path
from unittest.mock import Mock

import pytest

from nao_core.commands.test.case import TestCase as NaoTestCase
from nao_core.commands.test.client import (
    AgentClientError,
    TokenCost,
    TokenUsage,
    VerificationResult,
    serialize_model_costs,
)
from nao_core.commands.test.client import (
    TestResult as AgentTestResult,
)
from nao_core.commands.test.junit import save_results_junit
from nao_core.commands.test.runner import (
    ModelConfig,
    TestRunDetails,
    TestRunResult,
    check_dataframe,
    filter_test_cases,
    run_test,
    save_results,
)
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


def test_run_test_records_reference_sql_with_verification(monkeypatch):
    test_case = NaoTestCase(name="orders", prompt="p1", file_path=Path("tests/orders.yml"), sql="select 1")
    model = ModelConfig(provider="openai", model_id="custom-model")
    client = Mock()
    client.run_test.return_value = AgentTestResult(
        text="",
        tool_calls=[],
        usage=TokenUsage(totalTokens=0),
        cost=TokenCost(totalCost=0),
        finish_reason="stop",
        duration_ms=1,
        verification=VerificationResult(
            data=[{"total": 1}],
            expectedData=[{"total": 1}],
            expectedColumns=["total"],
        ),
    )
    monkeypatch.setattr(test_runner_module, "get_client", lambda **_: client)

    result = run_test(test_case, model)

    assert result.passed is True
    assert result.details is not None
    assert result.details.reference_sql == "select 1"


def test_run_test_records_reference_sql_without_verification(monkeypatch):
    test_case = NaoTestCase(name="orders", prompt="p1", file_path=Path("tests/orders.yml"), sql="select 1")
    model = ModelConfig(provider="openai", model_id="custom-model")
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

    result = run_test(test_case, model)

    assert result.details is not None
    assert result.details.reference_sql == "select 1"


def test_run_test_records_reference_sql_on_client_error(monkeypatch):
    test_case = NaoTestCase(name="orders", prompt="p1", file_path=Path("tests/orders.yml"), sql="select 1")
    model = ModelConfig(provider="openai", model_id="custom-model")
    client = Mock()
    client.run_test.side_effect = AgentClientError("backend unreachable")
    monkeypatch.setattr(test_runner_module, "get_client", lambda **_: client)

    result = run_test(test_case, model)

    assert result.passed is False
    assert result.error == "backend unreachable"
    assert result.details is not None
    assert result.details.reference_sql == "select 1"


def test_filter_test_cases_by_folder(tmp_path):
    tests_dir = tmp_path / "tests"
    tc_orders = NaoTestCase(name="orders", prompt="p1", file_path=tests_dir / "revenue" / "orders.yml", sql="select 1")
    tc_mrr = NaoTestCase(name="mrr", prompt="p2", file_path=tests_dir / "revenue" / "mrr.yml", sql="select 1")
    tc_users = NaoTestCase(name="users", prompt="p3", file_path=tests_dir / "ops" / "users.yml", sql="select 1")

    filtered = filter_test_cases([tc_orders, tc_mrr, tc_users], "revenue", tests_dir)

    assert {tc.name for tc in filtered} == {"orders", "mrr"}


def test_filter_test_cases_folder_and_name_combined(tmp_path):
    tests_dir = tmp_path / "tests"
    tc_orders = NaoTestCase(name="orders", prompt="p1", file_path=tests_dir / "revenue" / "orders.yml", sql="select 1")
    tc_users = NaoTestCase(name="users", prompt="p2", file_path=tests_dir / "ops" / "users.yml", sql="select 1")

    filtered = filter_test_cases([tc_orders, tc_users], "revenue,users", tests_dir)

    assert {tc.name for tc in filtered} == {"orders", "users"}


def test_filter_test_cases_by_name_without_tests_dir_unchanged():
    # Backward-compat: two-arg call still filters by name/stem.
    test_cases = [
        NaoTestCase(name="orders", prompt="p1", file_path=Path("tests/orders.yml"), sql="select 1"),
        NaoTestCase(name="users", prompt="p2", file_path=Path("tests/users.yml"), sql="select 1"),
    ]

    filtered = filter_test_cases(test_cases, "users")

    assert len(filtered) == 1
    assert filtered[0].name == "users"


def _passed_result(name: str, model: str) -> TestRunResult:
    return TestRunResult(
        name=name,
        model=model,
        passed=True,
        message="match",
        tokens=100,
        cost=0.001,
        duration_ms=1_500,
        tool_call_count=2,
    )


def _failed_result(name: str, model: str) -> TestRunResult:
    return TestRunResult(
        name=name,
        model=model,
        passed=False,
        message="values differ",
        tokens=120,
        cost=0.002,
        duration_ms=2_000,
        tool_call_count=3,
        details=TestRunDetails(comparison="row 0:\n  actual:   1\n  expected: 2"),
    )


def _errored_result(name: str, model: str) -> TestRunResult:
    return TestRunResult(
        name=name,
        model=model,
        passed=False,
        message="error",
        error="backend unreachable",
        tokens=None,
        cost=None,
        duration_ms=500,
        tool_call_count=0,
    )


def _skipped_result(name: str, model: str) -> TestRunResult:
    return TestRunResult(
        name=name,
        model=model,
        passed=True,
        message="no verification",
        tokens=50,
        cost=0.0005,
        duration_ms=800,
        tool_call_count=1,
    )


def test_save_results_junit_writes_xml_file(tmp_path):
    output_dir = tmp_path / "outputs"

    output_file = save_results_junit([_passed_result("orders", "openai:gpt-4.1")], output_dir)

    assert output_file.exists()
    assert output_file.suffix == ".xml"
    assert output_file.parent == output_dir
    assert output_file.read_text(encoding="utf-8").startswith("<?xml")


def test_save_results_junit_aggregates_run_status(tmp_path):
    results = [
        _passed_result("orders", "openai:gpt-4.1"),
        _failed_result("orders", "anthropic:claude-sonnet-4-20250514"),
        _errored_result("users", "openai:gpt-4.1"),
        _skipped_result("users", "anthropic:claude-sonnet-4-20250514"),
    ]

    output_file = save_results_junit(results, tmp_path)
    root_text = output_file.read_text(encoding="utf-8")

    assert 'tests="4"' in root_text
    assert 'failures="1"' in root_text
    assert 'errors="1"' in root_text
    assert 'skipped="1"' in root_text


def test_save_results_junit_renders_passed_run_as_bare_testcase(tmp_path):
    output_file = save_results_junit([_passed_result("orders", "openai:gpt-4.1")], tmp_path)
    text = output_file.read_text(encoding="utf-8")

    assert '<testcase name="openai:gpt-4.1" classname="nao-test"' in text
    assert "<failure" not in text
    assert "<error" not in text
    assert "<skipped" not in text
    assert "<system-out>tokens=100 cost=0.001 duration_ms=1500 tool_calls=2</system-out>" in text


def test_save_results_junit_renders_failed_run_with_failure_and_comparison(tmp_path):
    output_file = save_results_junit([_failed_result("orders", "openai:gpt-4.1")], tmp_path)
    text = output_file.read_text(encoding="utf-8")

    assert '<failure message="values differ" type="failure">values differ' in text
    assert "row 0:" in text
    assert 'failures="1"' in text


def test_save_results_junit_renders_errored_run_with_error(tmp_path):
    output_file = save_results_junit([_errored_result("users", "openai:gpt-4.1")], tmp_path)
    text = output_file.read_text(encoding="utf-8")

    assert '<error message="backend unreachable" type="error">backend unreachable</error>' in text
    assert 'errors="1"' in text


def test_save_results_junit_renders_no_verification_as_skipped(tmp_path):
    output_file = save_results_junit([_skipped_result("users", "openai:gpt-4.1")], tmp_path)
    text = output_file.read_text(encoding="utf-8")

    assert '<skipped message="no verification"' in text
    assert 'skipped="1"' in text


def test_save_results_junit_groups_runs_into_testsuites_per_test_name(tmp_path):
    results = [
        _passed_result("orders", "openai:gpt-4.1"),
        _passed_result("orders", "anthropic:claude-sonnet-4-20250514"),
        _passed_result("users", "openai:gpt-4.1"),
    ]

    output_file = save_results_junit(results, tmp_path)
    text = output_file.read_text(encoding="utf-8")

    assert text.count("<testsuite ") == 3
    assert '<testsuite name="orders"' in text
    assert '<testsuite name="users"' in text
    assert text.count("<testcase") == 3


def test_save_results_junit_sums_total_time_in_seconds(tmp_path):
    results = [
        TestRunResult(name="orders", model="openai:gpt-4.1", passed=True, message="match", duration_ms=1_500),
        TestRunResult(
            name="users",
            model="openai:gpt-4.1",
            passed=True,
            message="match",
            duration_ms=2_500,
        ),
    ]

    output_file = save_results_junit(results, tmp_path)
    text = output_file.read_text(encoding="utf-8")

    assert 'time="4.000"' in text
    assert 'time="1.500"' in text
    assert 'time="2.500"' in text


def test_save_results_junit_creates_output_dir_if_missing(tmp_path):
    output_dir = tmp_path / "nested" / "outputs"

    output_file = save_results_junit([_passed_result("orders", "openai:gpt-4.1")], output_dir)

    assert output_dir.is_dir()
    assert output_file.exists()


def test_save_results_dispatches_to_junit_when_requested(tmp_path):
    results = [_passed_result("orders", "openai:gpt-4.1")]

    output_file = save_results(results, tmp_path, fmt="junit")

    assert output_file.suffix == ".xml"
    assert output_file.read_text(encoding="utf-8").startswith("<?xml")


def test_save_results_default_remains_json(tmp_path):
    results = [_passed_result("orders", "openai:gpt-4.1")]

    output_file = save_results(results, tmp_path)

    assert output_file.suffix == ".json"
    import json

    data = json.loads(output_file.read_text(encoding="utf-8"))
    assert data["summary"]["total"] == 1
    assert data["results"][0]["name"] == "orders"
