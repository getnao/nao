import importlib
import json
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
from nao_core.commands.test.runner import (
    MAX_K,
    ModelConfig,
    TestRunResult,
    build_metrics,
    check_dataframe,
    filter_test_cases,
    pass_at_k,
    pass_pow_k,
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


# =============================================================================
# pass_at_k / pass_pow_k — Codex-style unbiased estimator
# =============================================================================


def test_pass_at_k_all_succeed_returns_one():
    assert pass_at_k(n=5, c=5, k=1) == 1.0
    assert pass_at_k(n=5, c=5, k=5) == 1.0


def test_pass_at_k_none_succeed_returns_zero():
    assert pass_at_k(n=5, c=0, k=1) == 0.0
    assert pass_at_k(n=5, c=0, k=5) == 0.0


def test_pass_at_k_when_n_equals_k_is_step_function():
    # Standard Codex estimator: when n == k, pass@k is 1.0 if any attempt
    # succeeded, else 0.0. Verify both edges.
    assert pass_at_k(n=5, c=1, k=5) == 1.0
    assert pass_at_k(n=5, c=4, k=5) == 1.0
    assert pass_at_k(n=5, c=0, k=5) == 0.0


def test_pass_at_k_when_n_greater_than_k_is_unbiased():
    # n=10, c=3, k=5 -> 1 - C(7,5) / C(10,5) = 1 - 21/252 = 0.9167
    expected = 1 - (21 / 252)
    assert pass_at_k(n=10, c=3, k=5) == pytest.approx(expected, rel=1e-9)

    # n=10, c=6, k=5 -> 1 - C(4,5)/C(10,5) = 1 - 0/252 = 1.0 (impossible to draw
    # 5 failures when only 4 exist)
    assert pass_at_k(n=10, c=6, k=5) == 1.0


def test_pass_at_k_rejects_invalid_inputs():
    with pytest.raises(ValueError, match="k must be positive"):
        pass_at_k(n=5, c=2, k=0)
    with pytest.raises(ValueError, match="invalid"):
        pass_at_k(n=3, c=5, k=1)
    with pytest.raises(ValueError, match="invalid"):
        pass_at_k(n=-1, c=0, k=1)


def test_pass_pow_k_all_succeed_returns_one():
    assert pass_pow_k(n=5, c=5, k=5) == 1.0
    assert pass_pow_k(n=5, c=5, k=1) == 1.0
    assert pass_pow_k(n=5, c=4, k=4) == 1.0  # c == k with smaller k also passes


def test_pass_pow_k_any_failure_returns_zero():
    assert pass_pow_k(n=5, c=4, k=5) == 0.0
    assert pass_pow_k(n=5, c=0, k=1) == 0.0
    assert pass_pow_k(n=5, c=2, k=3) == 0.0


def test_pass_pow_k_underfilled_k_is_zero():
    # n < k means we did not actually run k attempts; pass^k is undefined
    # so the implementation reports 0.0 to avoid overstating reliability.
    assert pass_pow_k(n=1, c=1, k=3) == 0.0


def test_pass_pow_k_rejects_invalid_inputs():
    with pytest.raises(ValueError, match="k must be positive"):
        pass_pow_k(n=5, c=2, k=0)
    with pytest.raises(ValueError, match="invalid"):
        pass_pow_k(n=3, c=5, k=1)


# =============================================================================
# build_metrics — grouping + aggregation
# =============================================================================


def _result(name: str, model: str, passed: bool, error: str | None = None) -> TestRunResult:
    return TestRunResult(
        name=name,
        model=model,
        passed=passed,
        message="match" if passed else "fail",
        tokens=10,
        cost=0.001,
        duration_ms=100,
        tool_call_count=1,
        error=error,
    )


def test_build_metrics_empty_input_returns_empty_list():
    assert build_metrics([], k=1) == []


def test_build_metrics_single_pair_single_attempt_k1():
    metrics = build_metrics([_result("orders", "openai:gpt-4.1", passed=True)], k=1)

    assert len(metrics) == 1
    m = metrics[0]
    assert m.name == "orders"
    assert m.model == "openai:gpt-4.1"
    assert m.k == 1
    assert m.attempts == 1
    assert m.successes == 1
    assert m.pass_at_k == 1.0
    assert m.pass_pow_k == 1.0
    assert m.label == "1/1"
    assert m.tokens == 10
    assert m.cost == 0.001
    assert m.duration_ms == 100
    assert m.tool_call_count == 1


def test_build_metrics_groups_attempts_by_pair():
    # Realistic input: 3 attempts per model, two models, two distinct
    # pass patterns. k=3 means n=3 for both pairs.
    results = [
        _result("orders", "openai:gpt-4.1", passed=True),
        _result("orders", "openai:gpt-4.1", passed=False),
        _result("orders", "openai:gpt-4.1", passed=True),
        _result("orders", "anthropic:claude-sonnet-4-20250514", passed=True),
        _result("orders", "anthropic:claude-sonnet-4-20250514", passed=True),
        _result("orders", "anthropic:claude-sonnet-4-20250514", passed=True),
    ]

    metrics = build_metrics(results, k=3)

    by_model = {m.model: m for m in metrics}
    assert set(by_model) == {"openai:gpt-4.1", "anthropic:claude-sonnet-4-20250514"}

    gpt = by_model["openai:gpt-4.1"]
    assert gpt.attempts == 3
    assert gpt.successes == 2
    # n == k == 3, c == 2 -> step function: 1.0
    assert gpt.pass_at_k == 1.0
    # c < k -> 0.0
    assert gpt.pass_pow_k == 0.0
    assert gpt.label == "2/3"

    sonnet = by_model["anthropic:claude-sonnet-4-20250514"]
    assert sonnet.attempts == 3
    assert sonnet.successes == 3
    assert sonnet.pass_at_k == 1.0
    assert sonnet.pass_pow_k == 1.0
    assert sonnet.label == "3/3"


def test_build_metrics_errors_count_as_failures():
    results = [
        _result("orders", "openai:gpt-4.1", passed=False, error="timeout"),
        _result("orders", "openai:gpt-4.1", passed=True),
    ]

    [metric] = build_metrics(results, k=2)
    assert metric.attempts == 2
    assert metric.successes == 1
    assert metric.pass_at_k == 1.0  # at least one success
    assert metric.pass_pow_k == 0.0  # not all passed


def test_build_metrics_all_pass_yields_pass_pow_k_one():
    results = [_result("orders", "openai:gpt-4.1", passed=True) for _ in range(5)]

    [metric] = build_metrics(results, k=5)
    assert metric.attempts == 5
    assert metric.successes == 5
    assert metric.pass_at_k == 1.0
    assert metric.pass_pow_k == 1.0
    assert metric.label == "5/5"


def test_build_metrics_no_attempts_yields_zero_metrics():
    # Guard against a degenerate case — we never expect this in practice, but
    # the function should not crash on empty pairs.
    metrics = build_metrics([], k=5)
    assert metrics == []


# =============================================================================
# save_results — JSON shape and backward compatibility
# =============================================================================


def _make_results():
    return [
        _result("orders", "openai:gpt-4.1", passed=True),
        _result("users", "openai:gpt-4.1", passed=False),
    ]


def test_save_results_k1_preserves_pre_k1_schema(tmp_path):
    results = _make_results()
    out = save_results(results, tmp_path, metrics=None, k=1)
    payload = json.loads(out.read_text())

    # Top-level keys we still emit.
    assert set(payload) >= {"timestamp", "results", "summary"}
    # The flat results array is preserved for backwards compatibility.
    assert len(payload["results"]) == 2
    assert {r["name"] for r in payload["results"]} == {"orders", "users"}
    # Summary fields are unchanged in shape.
    assert payload["summary"]["total"] == 2
    assert payload["summary"]["passed"] == 1
    assert payload["summary"]["failed"] == 1
    # The k field is added but is the default — no behavior change for k=1.
    assert payload["k"] == 1
    # Metrics list is empty when no metrics were provided.
    assert payload["metrics"] == []


def test_save_results_k_greater_than_1_includes_metrics(tmp_path):
    results = [
        _result("orders", "openai:gpt-4.1", passed=True),
        _result("orders", "openai:gpt-4.1", passed=False),
        _result("orders", "openai:gpt-4.1", passed=True),
    ]
    metrics = build_metrics(results, k=3)
    out = save_results(results, tmp_path, metrics=metrics, k=3)
    payload = json.loads(out.read_text())

    assert payload["k"] == 3
    assert len(payload["metrics"]) == 1
    metric = payload["metrics"][0]
    assert metric["name"] == "orders"
    assert metric["model"] == "openai:gpt-4.1"
    assert metric["k"] == 3
    assert metric["attempts"] == 3
    assert metric["successes"] == 2
    assert metric["pass_at_k"] == 1.0
    assert metric["pass_pow_k"] == 0.0
    # Metrics don't carry per-attempt payloads — those live in `results`.
    assert "attempt_results" not in metric
    # Summary still counts attempts (k * pairs), so CI consumers can still read it.
    assert payload["summary"]["total"] == 3
    assert payload["summary"]["passed"] == 2
    assert payload["summary"]["failed"] == 1


def test_save_results_emits_timestamped_file(tmp_path):
    # Filename uses second-precision timestamp; we just verify the file is
    # written and has the expected `results_<timestamp>.json` shape.
    out = save_results(_make_results(), tmp_path, metrics=None, k=1)
    assert out.exists()
    assert out.name.startswith("results_")
    assert out.suffix == ".json"


# =============================================================================
# Constants — sanity check
# =============================================================================


def test_max_k_is_a_positive_integer():
    # We rely on MAX_K as a guard rail. Catch a regression if someone changes
    # the type to e.g. a float.
    assert isinstance(MAX_K, int)
    assert MAX_K >= 1
