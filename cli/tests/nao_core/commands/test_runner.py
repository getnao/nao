import importlib
import json
import time
from pathlib import Path
from unittest.mock import Mock

import pytest

from nao_core.commands.test.case import TestCase as NaoTestCase
from nao_core.commands.test.client import (
    AgentClient,
    AgentClientError,
    TokenCost,
    TokenUsage,
    VerificationResult,
    serialize_model_costs,
)
from nao_core.commands.test.client import (
    TestResult as AgentTestResult,
)
from nao_core.commands.test.runner import ModelConfig, check_dataframe, filter_test_cases, run_test
from nao_core.commands.test.runner import (
    TestRunResult as NaoTestRunResult,
)
from nao_core.config.base import NaoConfig
from nao_core.config.llm import ModelCosts
from nao_core.config.test import ComparisonConfig, TestConfig

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


def test_check_dataframe_reports_the_verification_error_when_no_data_was_produced():
    verification = VerificationResult(
        data=None,
        expectedData=[{"total": 1}],
        expectedColumns=["total"],
        error="Binder Error: column total does not exist",
    )

    passed, msg, comparison = check_dataframe(verification)

    assert passed is False
    assert msg == "Binder Error: column total does not exist"
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


def _successful_run_response() -> Mock:
    response = Mock()
    response.status_code = 200
    response.json.return_value = {
        "text": "",
        "toolCalls": [],
        "usage": {"totalTokens": 0},
        "cost": {"totalCost": 0},
        "finishReason": "stop",
    }
    return response


def test_client_sends_the_test_case_database_as_database_id(monkeypatch):
    test_case = NaoTestCase(
        name="orders", prompt="p1", file_path=Path("tests/orders.yml"), sql="select 1", database="bigquery-prod"
    )
    client = AgentClient(backend_url="http://backend")
    session = Mock()
    session.post.return_value = _successful_run_response()
    monkeypatch.setattr(client, "_get_session", lambda: session)

    client.run_test(test_case)

    payload = session.post.call_args.kwargs["json"]
    assert payload["databaseId"] == "bigquery-prod"


def test_client_omits_database_id_when_the_test_case_has_none(monkeypatch):
    test_case = NaoTestCase(name="orders", prompt="p1", file_path=Path("tests/orders.yml"), sql="select 1")
    client = AgentClient(backend_url="http://backend")
    session = Mock()
    session.post.return_value = _successful_run_response()
    monkeypatch.setattr(client, "_get_session", lambda: session)

    client.run_test(test_case)

    payload = session.post.call_args.kwargs["json"]
    assert "databaseId" not in payload


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
            sql="SELECT total FROM query_abc",
        ),
    )
    monkeypatch.setattr(test_runner_module, "get_client", lambda **_: client)

    result = run_test(test_case, model)

    assert result.passed is True
    assert result.details is not None
    assert result.details.reference_sql == "select 1"
    assert result.details.verification_sql == "SELECT total FROM query_abc"


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


def run_test_command(monkeypatch, tmp_path, config, tables: list | None = None, **flags) -> list[dict]:
    """Run the `nao test` command against stubbed collaborators and report what it ran.

    Pass ``tables`` to also collect the (title, dataframe) pairs printed as summaries.
    """
    cases = [
        NaoTestCase(name="orders", prompt="p1", file_path=tmp_path / "orders.yml", sql="select 1"),
        NaoTestCase(name="users", prompt="p2", file_path=tmp_path / "users.yml", sql="select 1"),
    ]
    runs: list[dict] = []

    def run(test_case, model, **kwargs):
        runs.append({"case": test_case, "model": model, **kwargs})
        return NaoTestRunResult(name=test_case.name, model=str(model), passed=True, message="match")

    def table(df, title=None, **kwargs):
        if tables is not None:
            tables.append((title, df))

    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr(test_runner_module, "NaoConfig", Mock(try_load=Mock(return_value=config)))
    monkeypatch.setattr(test_runner_module, "discover_tests", lambda project_path: cases)
    monkeypatch.setattr(test_runner_module, "run_test", run)
    monkeypatch.setattr(test_runner_module, "save_results", lambda results, output_dir: output_dir / "results.json")
    monkeypatch.setattr(test_runner_module.UI, "table", table)

    test_runner_module.test(**flags)

    return runs


def test_run_uses_the_test_block_defaults(tmp_path, monkeypatch):
    config = NaoConfig(
        project_name="test-project",
        test=TestConfig(models=["anthropic:claude-sonnet-4-5"], comparison=ComparisonConfig(decimals=4)),
    )

    runs = run_test_command(monkeypatch, tmp_path, config)

    assert [str(run["model"]) for run in runs] == ["anthropic:claude-sonnet-4-5"] * 2
    assert runs[0]["comparison"].decimals == 4


def test_run_falls_back_to_defaults_without_a_test_block(tmp_path, monkeypatch):
    runs = run_test_command(monkeypatch, tmp_path, NaoConfig(project_name="test-project"))

    assert [str(run["model"]) for run in runs] == ["openai:gpt-4.1"] * 2
    assert runs[0]["comparison"].decimals == 2


def test_model_flag_overrides_the_test_block(tmp_path, monkeypatch):
    config = NaoConfig(project_name="test-project", test=TestConfig(models=["anthropic:claude-sonnet-4-5"]))

    runs = run_test_command(monkeypatch, tmp_path, config, models=["openai:gpt-4.1"], select="users")

    assert [run["case"].name for run in runs] == ["users"]
    assert [str(run["model"]) for run in runs] == ["openai:gpt-4.1"]


def test_single_model_runs_only_print_the_run_table(tmp_path, monkeypatch):
    tables: list = []

    run_test_command(monkeypatch, tmp_path, NaoConfig(project_name="test-project"), tables=tables)

    assert [title for title, _ in tables] == ["Test Results"]


def test_multi_model_runs_print_per_model_summaries(tmp_path, monkeypatch):
    config = NaoConfig(project_name="test-project", test=TestConfig(models=["openai:gpt-4.1", "anthropic:claude-4-5"]))
    tables: list = []

    run_test_command(monkeypatch, tmp_path, config, tables=tables)

    titles = [title for title, _ in tables]
    assert titles == ["Test Results", "Performance by Model", "Pass / Fail by Test and Model"]

    matrix = dict(tables)["Pass / Fail by Test and Model"]
    assert list(matrix.columns) == ["Test", "openai\ngpt-4.1", "anthropic\nclaude-4-5"]
    assert matrix["Test"].tolist() == ["orders", "users"]


def test_threaded_runs_are_reported_grouped_by_model(tmp_path, monkeypatch):
    config = NaoConfig(project_name="test-project", test=TestConfig(models=["openai:gpt-4.1", "anthropic:claude-4-5"]))
    cases = [
        NaoTestCase(name="orders", prompt="p1", file_path=tmp_path / "orders.yml", sql="select 1"),
        NaoTestCase(name="users", prompt="p2", file_path=tmp_path / "users.yml", sql="select 1"),
    ]
    # Slowest run is submitted first so completions finish in reverse of submission order.
    delays = {
        ("openai:gpt-4.1", "orders"): 0.04,
        ("openai:gpt-4.1", "users"): 0.03,
        ("anthropic:claude-4-5", "orders"): 0.02,
        ("anthropic:claude-4-5", "users"): 0.01,
    }
    saved: list[NaoTestRunResult] = []

    def run(test_case, model, **kwargs):
        time.sleep(delays[(str(model), test_case.name)])
        return NaoTestRunResult(name=test_case.name, model=str(model), passed=True, message="match")

    def save_results(results, output_dir):
        saved.extend(results)
        return output_dir / "results.json"

    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr(test_runner_module, "NaoConfig", Mock(try_load=Mock(return_value=config)))
    monkeypatch.setattr(test_runner_module, "discover_tests", lambda project_path: cases)
    monkeypatch.setattr(test_runner_module, "run_test", run)
    monkeypatch.setattr(test_runner_module, "save_results", save_results)
    monkeypatch.setattr(test_runner_module.UI, "table", lambda *args, **kwargs: None)

    test_runner_module.test(threads=4)

    assert [(r.model, r.name) for r in saved] == [
        ("openai:gpt-4.1", "orders"),
        ("openai:gpt-4.1", "users"),
        ("anthropic:claude-4-5", "orders"),
        ("anthropic:claude-4-5", "users"),
    ]


def test_save_results_records_per_model_summaries(tmp_path):
    results = [
        NaoTestRunResult(
            name="orders",
            model="openai:gpt-4.1",
            passed=True,
            message="match",
            tokens=100,
            cost=0.2,
            duration_ms=1000,
            tool_call_count=2,
        ),
        NaoTestRunResult(
            name="orders",
            model="anthropic:claude-4-5",
            passed=False,
            message="values differ",
            tokens=200,
            cost=0.1,
            duration_ms=3000,
            tool_call_count=4,
        ),
    ]

    output_file = test_runner_module.save_results(results, tmp_path / "outputs")
    data = json.loads(output_file.read_text())

    assert data["summary"]["total"] == 2
    assert [model["model"] for model in data["by_model"]] == ["openai:gpt-4.1", "anthropic:claude-4-5"]
    assert data["by_model"][0]["pass_rate"] == 100.0
    assert data["by_model"][1]["avg_duration_ms"] == 3000
