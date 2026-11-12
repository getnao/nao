import importlib
import json
import time
from pathlib import Path
from typing import Any
from unittest.mock import Mock

import pytest

from nao_core.commands.test.assertions import ToolCallAssertion
from nao_core.commands.test.case import InvalidTestFileError
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
from nao_core.commands.test.client import (
    TestVerdict as AgentTestVerdict,
)
from nao_core.commands.test.runner import (
    ModelConfig,
    check_dataframe,
    filter_test_cases,
    resolve_model_configs,
    run_test,
)
from nao_core.commands.test.runner import (
    TestRunResult as NaoTestRunResult,
)
from nao_core.config.base import NaoConfig
from nao_core.config.llm import ModelCosts
from nao_core.config.test import ComparisonConfig, TestConfig, TestModelConfig

test_runner_module = importlib.import_module("nao_core.commands.test.runner")

MODEL = ModelConfig(provider="openai", model_id="custom-model")
COSTS = ModelCosts(input_no_cache=1.0, input_cache_read=0.1, input_cache_write=1.25, output=2.0)
MIXED_ATTEMPTS = [
    NaoTestRunResult(name="orders", model="m", passed=True, message="match"),
    NaoTestRunResult(name="orders", model="m", passed=False, message="values differ"),
]


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
    filtered = filter_test_cases([_case("orders"), _case("users")], "users")

    assert len(filtered) == 1
    assert filtered[0].name == "users"


def test_filter_test_cases_by_file_stem():
    filtered = filter_test_cases([_case("orders check", file_path=Path("tests/orders.yml"))], "orders")

    assert len(filtered) == 1
    assert filtered[0].name == "orders check"


def test_filter_test_cases_missing():
    with pytest.raises(ValueError, match="Test not found: missing"):
        filter_test_cases([_case("orders")], "missing")


def test_filter_test_cases_comma_separated():
    filtered = filter_test_cases([_case("orders"), _case("users"), _case("revenue")], "orders,revenue")

    assert [tc.name for tc in filtered] == ["orders", "revenue"]


def test_filter_test_cases_comma_separated_deduplicates():
    filtered = filter_test_cases([_case("orders"), _case("users")], "orders, orders ,users")

    assert [tc.name for tc in filtered] == ["orders", "users"]


def test_filter_test_cases_comma_separated_missing():
    with pytest.raises(ValueError, match="Test not found: missing"):
        filter_test_cases([_case("orders")], "orders,missing")


def test_serialize_model_costs_uses_backend_field_names():
    assert serialize_model_costs(COSTS) == {
        "inputNoCache": 1.0,
        "inputCacheRead": 0.1,
        "inputCacheWrite": 1.25,
        "output": 2.0,
    }


def test_client_sends_the_test_case_database_as_database_id(monkeypatch):
    payload = _client_payload(monkeypatch, _case("orders", database="bigquery-prod"))

    assert payload["databaseId"] == "bigquery-prod"


def test_client_omits_database_id_when_the_test_case_has_none(monkeypatch):
    payload = _client_payload(monkeypatch, _case("orders"))

    assert "databaseId" not in payload


def test_client_omits_sql_when_the_test_case_is_assertion_only(monkeypatch):
    payload = _client_payload(monkeypatch, _clarification_case())

    assert "sql" not in payload


def test_client_sends_the_reasoning_effort_with_the_model(monkeypatch):
    payload = _client_payload(
        monkeypatch, _case("orders"), provider="openai", model_id="gpt-5", reasoning_effort="high"
    )

    assert payload["model"] == {"provider": "openai", "modelId": "gpt-5", "reasoningEffort": "high"}


def test_client_sends_the_credential_id_with_the_model(monkeypatch):
    payload = _client_payload(
        monkeypatch, _case("orders"), provider="openai", model_id="gpt-5", llm_config_id="credential-b"
    )

    assert payload["model"] == {
        "provider": "openai",
        "modelId": "gpt-5",
        "llmConfigId": "credential-b",
    }


def test_client_omits_the_reasoning_effort_without_one(monkeypatch):
    assert _client_payload(monkeypatch, _case("orders"))["model"] == {"provider": "openai", "modelId": "gpt-4.1"}


def test_client_lists_the_reasoning_efforts_of_a_model(monkeypatch):
    client = AgentClient(backend_url="http://backend")
    session = Mock()
    session.get.return_value = Mock(status_code=200, json=Mock(return_value={"reasoningEfforts": ["low", "high"]}))
    monkeypatch.setattr(client, "_get_session", lambda: (session, 0))

    assert client.get_reasoning_efforts("openai", "gpt-5") == ["low", "high"]
    session.get.assert_called_once_with(
        "http://backend/api/test/reasoning-efforts", params={"provider": "openai", "modelId": "gpt-5"}
    )


def test_client_reports_servers_that_cannot_list_reasoning_efforts(monkeypatch):
    client = AgentClient(backend_url="http://backend")
    session = Mock()
    session.get.return_value = Mock(status_code=404)
    monkeypatch.setattr(client, "_get_session", lambda: (session, 0))

    with pytest.raises(AgentClientError, match="update it first"):
        client.get_reasoning_efforts("openai", "gpt-5")


def test_resolve_model_configs_runs_a_model_once_per_reasoning_effort():
    client = Mock()
    client.get_reasoning_efforts.return_value = ["low", "medium", "high"]

    models = resolve_model_configs(
        [
            "openai:gpt-4.1",
            TestModelConfig(model="openai:gpt-5", reasoning_efforts=["high", "low"]),
            TestModelConfig(model="anthropic:claude-opus-4-5", reasoning_efforts="all"),
            TestModelConfig(model="anthropic:claude-haiku-4-5"),
        ],
        client,
    )

    assert [str(model) for model in models] == [
        "openai:gpt-4.1",
        "openai:gpt-5 · low",
        "openai:gpt-5 · high",
        "anthropic:claude-opus-4-5 · low",
        "anthropic:claude-opus-4-5 · medium",
        "anthropic:claude-opus-4-5 · high",
        "anthropic:claude-haiku-4-5",
    ]
    assert client.get_reasoning_efforts.call_count == 2


def test_resolve_model_configs_preserves_the_credential_id():
    models = resolve_model_configs(
        [TestModelConfig(model="openai:gpt-5", llm_config_id="credential-b")],
        Mock(),
    )

    assert models == [ModelConfig(provider="openai", model_id="gpt-5", llm_config_id="credential-b")]
    assert str(models[0]) == "openai:gpt-5@credential-b"


def test_resolve_model_configs_rejects_efforts_the_model_does_not_support():
    client = Mock()
    client.get_reasoning_efforts.return_value = ["low", "high"]

    with pytest.raises(ValueError, match="does not support the reasoning efforts max, expected some of low, high"):
        resolve_model_configs([TestModelConfig(model="openai:gpt-5", reasoning_efforts=["low", "max"])], client)


def test_resolve_model_configs_rejects_efforts_for_a_model_without_any():
    client = Mock()
    client.get_reasoning_efforts.return_value = []

    with pytest.raises(ValueError, match="has no reasoning efforts"):
        resolve_model_configs([TestModelConfig(model="openai:gpt-4.1", reasoning_efforts="all")], client)


def test_run_test_sends_the_reasoning_effort_of_the_model(monkeypatch):
    test_case = NaoTestCase(name="orders", prompt="p1", file_path=Path("tests/orders.yml"))
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

    result = run_test(test_case, ModelConfig(provider="openai", model_id="gpt-5", reasoning_effort="low"))

    assert result.model == "openai:gpt-5 · low"
    assert client.run_test.call_args.kwargs["reasoning_effort"] == "low"


def test_client_authenticates_with_the_api_key_without_logging_in(monkeypatch):
    client_module = importlib.import_module("nao_core.commands.test.client")
    get_auth_session = Mock()
    monkeypatch.setattr(client_module, "get_auth_session", get_auth_session)
    client = AgentClient(backend_url="http://backend", api_key="nao_secret", project_name="shop")

    session, _ = client._get_session()

    get_auth_session.assert_not_called()
    assert session.headers["Authorization"] == "Bearer nao_secret"
    assert session.headers["x-nao-project-name"] == "shop"


def test_client_does_not_retry_login_when_the_api_key_is_rejected(monkeypatch):
    client_module = importlib.import_module("nao_core.commands.test.client")
    interactive_login = Mock()
    monkeypatch.setattr(client_module, "interactive_login", interactive_login)
    test_case = NaoTestCase(name="orders", prompt="p1", file_path=Path("tests/orders.yml"), sql="select 1")
    client = AgentClient(backend_url="http://backend", api_key="nao_revoked")
    session = Mock()
    session.post.return_value = Mock(status_code=401)
    monkeypatch.setattr(client, "_get_session", lambda: (session, 0))

    with pytest.raises(AgentClientError, match="Invalid API key"):
        client.run_test(test_case)

    interactive_login.assert_not_called()


def test_client_sends_assertions_and_comparison_tolerances(monkeypatch):
    test_case = NaoTestCase(
        name="orders",
        prompt="p1",
        file_path=Path("tests/orders.yml"),
        assertions=[
            ToolCallAssertion(tool="execute_sql"),
            ToolCallAssertion(tool="query_metrics", args={"metric": "revenue"}, min_count=2),
        ],
    )

    payload = _client_payload(monkeypatch, test_case, comparison=ComparisonConfig(decimals=4))

    assert payload["assertions"] == [
        {"type": "tool_call", "tool": "execute_sql", "min_count": 1},
        {"type": "tool_call", "tool": "query_metrics", "min_count": 2, "args": {"metric": "revenue"}},
    ]
    assert payload["comparison"] == {"rtol": 1e-5, "atol": 1e-8, "decimals": 4}


def test_client_parses_the_server_verdict(monkeypatch):
    test_case = NaoTestCase(name="orders", prompt="p1", file_path=Path("tests/orders.yml"))
    client, _ = _client_answering(
        monkeypatch,
        verdict={"passed": False, "message": "values differ", "comparison": "row 0, total: actual=1, expected=2"},
    )

    result = client.run_test(test_case)

    assert result.verdict == AgentTestVerdict(
        passed=False, message="values differ", comparison="row 0, total: actual=1, expected=2"
    )


def test_client_ignores_verification_fields_it_does_not_know(monkeypatch):
    test_case = NaoTestCase(name="orders", prompt="p1", file_path=Path("tests/orders.yml"), sql="select 1")
    client, _ = _client_answering(
        monkeypatch,
        verification={
            "data": [{"total": 1}],
            "expectedData": [{"total": 1}],
            "expectedColumns": ["total"],
            "sql": "select total from query_1",
            "sourceQueries": [{"id": "query_1", "sql": "select 1 as total"}],
            "error": None,
        },
    )

    result = client.run_test(test_case)

    assert result.verification == VerificationResult(
        data=[{"total": 1}],
        expectedData=[{"total": 1}],
        expectedColumns=["total"],
        sql="select total from query_1",
    )


def test_run_test_prefers_the_server_verdict_over_local_checks(monkeypatch):
    test_case = NaoTestCase(
        name="orders",
        prompt="total revenue",
        file_path=Path("tests/orders.yml"),
        sql="select 1",
        assertions=[ToolCallAssertion(tool="execute_sql")],
    )
    model = ModelConfig(provider="openai", model_id="custom-model")
    client = Mock()
    client.run_test.return_value = AgentTestResult(
        text="ok",
        tool_calls=[{"toolName": "execute_sql", "args": {}}],
        usage=TokenUsage(totalTokens=5),
        cost=TokenCost(totalCost=0.0),
        finish_reason="stop",
        duration_ms=2,
        verification=VerificationResult(
            data=[{"total": 1}],
            expectedData=[{"total": 1}],
            expectedColumns=["total"],
            sql="SELECT total FROM query_abc",
        ),
        verdict=AgentTestVerdict(passed=False, message="tool_call: execute_sql; values differ", comparison="diff"),
    )
    monkeypatch.setattr(test_runner_module, "get_client", lambda **_: client)

    result = run_test(test_case, model, comparison=ComparisonConfig())

    assert result.passed is False
    assert result.message == "tool_call: execute_sql; values differ"
    assert result.details is not None
    assert result.details.comparison == "diff"
    assert result.details.actual_data == [{"total": 1}]
    assert result.details.verification_sql == "SELECT total FROM query_abc"


def test_run_test_passes_configured_costs_to_client(monkeypatch):
    test_case = _case("orders")
    client = _stub_client(monkeypatch, _agent_result())

    result = run_test(test_case, MODEL, costs=COSTS)

    assert result.passed is True
    client.run_test.assert_called_once_with(
        test_case,
        provider="openai",
        model_id="custom-model",
        llm_config_id=None,
        costs=COSTS,
        comparison=None,
        reasoning_effort=None,
    )


def test_run_test_records_reference_sql_with_verification(monkeypatch):
    _stub_client(
        monkeypatch,
        _agent_result(
            verification=VerificationResult(
                data=[{"total": 1}],
                expectedData=[{"total": 1}],
                expectedColumns=["total"],
                sql="SELECT total FROM query_abc",
            ),
        ),
    )

    result = run_test(_case("orders"), MODEL)

    assert result.passed is True
    assert result.details is not None
    assert result.details.reference_sql == "select 1"
    assert result.details.verification_sql == "SELECT total FROM query_abc"


def test_run_test_records_reference_sql_without_verification(monkeypatch):
    _stub_client(monkeypatch, _agent_result())

    result = run_test(_case("orders"), MODEL)

    assert result.details is not None
    assert result.details.reference_sql == "select 1"


def test_run_test_records_reference_sql_on_client_error(monkeypatch):
    client = _stub_client(monkeypatch)
    client.run_test.side_effect = AgentClientError("backend unreachable")

    result = run_test(_case("orders"), MODEL)

    assert result.passed is False
    assert result.error == "backend unreachable"
    assert result.details is not None
    assert result.details.reference_sql == "select 1"


def test_run_test_assertion_only_passes_when_tool_called(monkeypatch):
    """Issue #1261: assert the agent asked a follow-up (clarification tool)."""
    _stub_client(
        monkeypatch,
        _agent_result(
            text="Which time period should I use?",
            tool_calls=[{"toolName": "clarification", "args": {"question": "Which time period?"}}],
        ),
    )

    result = run_test(_clarification_case(), MODEL)

    assert result.passed is True
    assert result.message == "tool_call: clarification"


def test_run_test_assertion_only_fails_when_agent_returns_numeric_answer(monkeypatch):
    """Issue #1261 fail direction: numeric SQL answer instead of a follow-up."""
    _stub_client(
        monkeypatch,
        _agent_result(
            text="Total revenue is 52123123",
            tool_calls=[
                {
                    "toolName": "execute_sql",
                    "args": {"sql_query": "SELECT SUM(amount) AS total_revenue FROM orders"},
                }
            ],
        ),
    )

    result = run_test(_clarification_case(), MODEL)

    assert result.passed is False
    assert result.message == "missing tool_call: clarification"


def test_run_test_combines_sql_verification_and_tool_assertion(monkeypatch):
    _stub_client(
        monkeypatch,
        _agent_result(
            text="ok",
            tool_calls=[{"toolName": "execute_sql", "args": {"sql_query": "SELECT 1"}}],
            verification=VerificationResult(
                data=[{"total": 1}],
                expectedData=[{"total": 1}],
                expectedColumns=["total"],
                sql="SELECT total FROM query_abc",
            ),
        ),
    )

    result = run_test(_revenue_case_asserting("execute_sql"), MODEL)

    assert result.passed is True
    assert result.message == "tool_call: execute_sql; match"


def test_run_test_fails_when_sql_matches_but_tool_assertion_missing(monkeypatch):
    _stub_client(
        monkeypatch,
        _agent_result(
            text="ok",
            tool_calls=[{"toolName": "execute_sql", "args": {}}],
            verification=VerificationResult(
                data=[{"total": 1}],
                expectedData=[{"total": 1}],
                expectedColumns=["total"],
            ),
        ),
    )

    result = run_test(_revenue_case_asserting("clarification"), MODEL)

    assert result.passed is False
    assert "missing tool_call: clarification" in result.message
    assert "match" in result.message


def test_run_test_fails_when_both_sql_and_assertions_configured_but_no_verification_data(monkeypatch):
    _stub_client(
        monkeypatch,
        _agent_result(
            text="ok",
            tool_calls=[{"toolName": "execute_sql", "args": {"sql_query": "SELECT 1"}}],
            verification=None,
        ),
    )

    result = run_test(_revenue_case_asserting("execute_sql"), MODEL)

    assert result.passed is False
    assert "tool_call: execute_sql" in result.message
    assert "no verification data" in result.message


def test_filter_test_cases_by_folder(tmp_path):
    tests_dir = tmp_path / "tests"
    tc_orders = _case("orders", file_path=tests_dir / "revenue" / "orders.yml")
    tc_mrr = _case("mrr", file_path=tests_dir / "revenue" / "mrr.yml")
    tc_users = _case("users", file_path=tests_dir / "ops" / "users.yml")

    filtered = filter_test_cases([tc_orders, tc_mrr, tc_users], "revenue", tests_dir)

    assert {tc.name for tc in filtered} == {"orders", "mrr"}


def test_filter_test_cases_folder_and_name_combined(tmp_path):
    tests_dir = tmp_path / "tests"
    tc_orders = _case("orders", file_path=tests_dir / "revenue" / "orders.yml")
    tc_users = _case("users", file_path=tests_dir / "ops" / "users.yml")

    filtered = filter_test_cases([tc_orders, tc_users], "revenue,users", tests_dir)

    assert {tc.name for tc in filtered} == {"orders", "users"}


def run_test_command(
    monkeypatch,
    tmp_path,
    config,
    tables: list | None = None,
    saved_results: list | None = None,
    saved_payload: list[dict] | None = None,
    outcomes: list[bool] | None = None,
    delays: dict[tuple[str, str], float] | None = None,
    **flags,
) -> list[dict]:
    """Run the `nao test` command against stubbed collaborators and report what it ran.

    Pass ``tables`` to also collect the (title, dataframe) pairs printed as summaries.
    Pass ``saved_results`` to capture the results list handed to ``save_results``.
    Pass ``delays`` to make each (model, case) run sleep before returning.
    """
    cases = [
        NaoTestCase(name="orders", prompt="p1", file_path=tmp_path / "orders.yml", sql="select 1"),
        NaoTestCase(name="users", prompt="p2", file_path=tmp_path / "users.yml", sql="select 1"),
    ]
    runs: list[dict] = []
    real_save_results = test_runner_module.save_results

    def run(test_case, model, **kwargs):
        if delays is not None:
            time.sleep(delays[(str(model), test_case.name)])
        runs.append({"case": test_case, "model": model, **kwargs})
        passed = outcomes[len(runs) - 1] if outcomes is not None else True
        return NaoTestRunResult(
            name=test_case.name, model=str(model), passed=passed, message="match" if passed else "values differ"
        )

    def table(df, title=None, **kwargs):
        if tables is not None:
            tables.append((title, df))

    def save(results, output_dir):
        if saved_results is not None:
            saved_results.extend(results)
        output_file = (
            real_save_results(results, output_dir) if saved_payload is not None else output_dir / "results.json"
        )
        if saved_payload is not None:
            saved_payload.append(json.loads(output_file.read_text()))
        return output_file

    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr(test_runner_module, "NaoConfig", Mock(try_load=Mock(return_value=config)))
    monkeypatch.setattr(test_runner_module, "discover_tests", lambda project_path: cases)
    monkeypatch.setattr(test_runner_module, "run_test", run)
    monkeypatch.setattr(test_runner_module, "save_results", save)
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
    saved: list[NaoTestRunResult] = []
    runs = run_test_command(monkeypatch, tmp_path, NaoConfig(project_name="test-project"), saved_results=saved)

    assert [str(run["model"]) for run in runs] == ["openai:gpt-4.1"] * 2
    assert runs[0]["comparison"].decimals == 2
    assert [r.attempt for r in saved] == [1, 1]


def test_model_flag_overrides_the_test_block(tmp_path, monkeypatch):
    config = NaoConfig(project_name="test-project", test=TestConfig(models=["anthropic:claude-sonnet-4-5"]))

    runs = run_test_command(monkeypatch, tmp_path, config, models=["openai:gpt-4.1"], select="users")

    assert [run["case"].name for run in runs] == ["users"]
    assert [str(run["model"]) for run in runs] == ["openai:gpt-4.1"]


def test_run_expands_the_reasoning_efforts_of_the_test_block(tmp_path, monkeypatch):
    client = Mock()
    client.get_reasoning_efforts.return_value = ["low", "high"]
    monkeypatch.setattr(test_runner_module, "get_client", lambda **_: client)
    config = NaoConfig(
        project_name="test-project",
        test=TestConfig(models=[TestModelConfig(model="openai:gpt-5", reasoning_efforts="all")]),
    )

    runs = run_test_command(monkeypatch, tmp_path, config, select="users")

    assert [str(run["model"]) for run in runs] == ["openai:gpt-5 · low", "openai:gpt-5 · high"]


def test_run_exits_with_an_error_when_the_reasoning_efforts_are_not_supported(tmp_path, monkeypatch):
    client = Mock()
    client.get_reasoning_efforts.return_value = ["low", "high"]
    monkeypatch.setattr(test_runner_module, "get_client", lambda **_: client)
    config = NaoConfig(
        project_name="test-project",
        test=TestConfig(models=[TestModelConfig(model="openai:gpt-5", reasoning_efforts=["max"])]),
    )

    with pytest.raises(SystemExit) as exit_info:
        run_test_command(monkeypatch, tmp_path, config)

    assert exit_info.value.code == 1


def test_single_model_runs_keep_legacy_output_for_k1(tmp_path, monkeypatch):
    tables: list = []

    run_test_command(monkeypatch, tmp_path, NaoConfig(project_name="test-project"), tables=tables)

    assert [title for title, _ in tables] == ["Test Results"]
    results_table = dict(tables)["Test Results"]
    assert list(results_table.columns) == [
        "Test",
        "Model",
        "Status",
        "Message",
        "Tokens",
        "Cost",
        "Time (s)",
        "Tools",
    ]
    assert results_table["Message"].tolist() == ["match"] * 2


def test_multi_model_runs_keep_legacy_output_for_k1(tmp_path, monkeypatch):
    config = NaoConfig(project_name="test-project", test=TestConfig(models=["openai:gpt-4.1", "anthropic:claude-4-5"]))
    tables: list = []

    run_test_command(monkeypatch, tmp_path, config, tables=tables)

    titles = [title for title, _ in tables]
    assert titles == ["Test Results", "Performance by Model", "Pass / Fail by Test and Model"]

    matrix = dict(tables)["Pass / Fail by Test and Model"]
    assert list(matrix.columns) == ["Test", "openai\ngpt-4.1", "anthropic\nclaude-4-5"]
    assert matrix["Test"].tolist() == ["orders", "users"]


def test_results_table_status_requires_all_attempts_to_pass(monkeypatch):
    tables = _capture_printed_tables(monkeypatch)
    test_runner_module.print_run_table(MIXED_ATTEMPTS)

    table = dict(tables)["Test Results"]
    assert table["Status"].tolist() == ["[red]✗[/red]"]
    assert table["Success %"].tolist() == ["[yellow]50.0%[/yellow]"]


def test_model_matrix_status_requires_all_attempts_to_pass(monkeypatch):
    tables = _capture_printed_tables(monkeypatch)
    test_runner_module.print_model_matrix(MIXED_ATTEMPTS)

    table = dict(tables)["Pass / Fail by Test and Model"]
    assert table["m"].tolist() == ["[red]✗[/red]"]


def test_summary_table_is_one_totals_row_with_always_pass_rate(monkeypatch):
    results = [
        NaoTestRunResult(
            name="orders",
            model="m",
            passed=True,
            message="match",
            tokens=100,
            cost=0.1,
            duration_ms=1000,
            tool_call_count=2,
        ),
        NaoTestRunResult(
            name="orders",
            model="m",
            passed=False,
            message="values differ",
            tokens=200,
            cost=0.2,
            duration_ms=2000,
            tool_call_count=3,
        ),
        NaoTestRunResult(
            name="users",
            model="m",
            passed=True,
            message="match",
            tokens=300,
            cost=0.3,
            duration_ms=3000,
            tool_call_count=4,
        ),
    ]
    tables = _capture_printed_tables(monkeypatch)
    test_runner_module.print_summary_table(results)

    title, table = tables[0]
    assert title == "Summary"
    assert len(table) == 1
    assert table.iloc[0].to_dict() == {
        "Tests": 2,
        "Success %": "[yellow]66.7%[/yellow]",
        "Always Pass %": "[yellow]50.0%[/yellow]",
        "Tokens": 600,
        "Cost": "$0.6000",
        "Time (s)": 6.0,
        "Tools": 9,
    }


def test_k_flag_runs_each_case_k_times_with_attempt_index(tmp_path, monkeypatch):
    config = NaoConfig(project_name="test-project", test=TestConfig(models=["openai:gpt-4.1"]))
    saved: list[NaoTestRunResult] = []
    tables: list = []

    runs = run_test_command(monkeypatch, tmp_path, config, tables=tables, saved_results=saved, k=3)

    # 2 test cases × 1 model × 3 attempts
    assert len(runs) == 6
    assert [(r.name, r.attempt) for r in saved] == [
        ("orders", 1),
        ("orders", 2),
        ("orders", 3),
        ("users", 1),
        ("users", 2),
        ("users", 3),
    ]
    results_table = dict(tables)["Test Results"]
    assert len(results_table) == 2
    assert "Success %" in results_table.columns
    assert dict(tables)["Summary"]["Always Pass %"].tolist() == ["[green]100.0%[/green]"]


def test_k_command_renders_mixed_pass_metrics_and_saves_aggregate(tmp_path, monkeypatch):
    config = NaoConfig(project_name="test-project", test=TestConfig(models=["openai:gpt-4.1"]))
    tables: list = []
    saved_payload: list[dict] = []

    with pytest.raises(SystemExit) as error:
        run_test_command(
            monkeypatch,
            tmp_path,
            config,
            tables=tables,
            saved_payload=saved_payload,
            outcomes=[True, False, True],
            k=3,
            select="orders",
        )
    assert error.value.code == 1

    results_table = dict(tables)["Test Results"]
    assert results_table["Pass@k"].tolist() == ["[green]100.0%[/green]"]
    assert dict(tables)["Summary"]["Always Pass %"].tolist() == ["[red]0.0%[/red]"]
    assert saved_payload[0]["pass_metrics"]["aggregate"] == {
        "pass_at_1": 2 / 3,
        "pass_at_k": 1.0,
        "pass_hat_k": 0.0,
    }


def test_k_config_default_used_when_flag_omitted(tmp_path, monkeypatch):
    config = NaoConfig(project_name="test-project", test=TestConfig(models=["openai:gpt-4.1"], k=2))
    saved: list[NaoTestRunResult] = []

    runs = run_test_command(monkeypatch, tmp_path, config, saved_results=saved)

    assert len(runs) == 4
    assert sorted(r.attempt for r in saved if r.name == "orders") == [1, 2]


def test_k_flag_overrides_config(tmp_path, monkeypatch):
    config = NaoConfig(project_name="test-project", test=TestConfig(models=["openai:gpt-4.1"], k=5))
    saved: list[NaoTestRunResult] = []

    runs = run_test_command(monkeypatch, tmp_path, config, saved_results=saved, k=2, select="orders")

    assert len(runs) == 2
    assert [r.attempt for r in saved] == [1, 2]


def test_invalid_k_is_rejected(tmp_path, monkeypatch):
    errors: list[str] = []
    monkeypatch.setattr(test_runner_module.UI, "error", lambda msg: errors.append(msg))
    config = NaoConfig(project_name="test-project", test=TestConfig(models=["openai:gpt-4.1"]))

    with pytest.raises(SystemExit) as exit_info:
        run_test_command(monkeypatch, tmp_path, config, k=0)

    assert exit_info.value.code == 1
    assert errors and "k must be >= 1" in errors[0]


def test_threaded_runs_are_reported_grouped_by_model(tmp_path, monkeypatch):
    config = NaoConfig(project_name="test-project", test=TestConfig(models=["openai:gpt-4.1", "anthropic:claude-4-5"]))
    # Slowest run is submitted first so completions finish in reverse of submission order.
    delays = {
        ("openai:gpt-4.1", "orders"): 0.04,
        ("openai:gpt-4.1", "users"): 0.03,
        ("anthropic:claude-4-5", "orders"): 0.02,
        ("anthropic:claude-4-5", "users"): 0.01,
    }
    saved: list[NaoTestRunResult] = []

    run_test_command(monkeypatch, tmp_path, config, saved_results=saved, delays=delays, threads=4)

    assert [(r.model, r.name) for r in saved] == [
        ("openai:gpt-4.1", "orders"),
        ("openai:gpt-4.1", "users"),
        ("anthropic:claude-4-5", "orders"),
        ("anthropic:claude-4-5", "users"),
    ]
    assert [r.attempt for r in saved] == [1, 1, 1, 1]


def test_run_exits_non_zero_when_a_test_file_fails_to_load(tmp_path, monkeypatch):
    ran: list = []

    def discover_tests(project_path):
        raise InvalidTestFileError(
            "Failed to load test file(s):\n  - broken.yml: unknown tool_call assertion fields: ['tol']"
        )

    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr(
        test_runner_module, "NaoConfig", Mock(try_load=Mock(return_value=NaoConfig(project_name="test-project")))
    )
    monkeypatch.setattr(test_runner_module, "discover_tests", discover_tests)
    monkeypatch.setattr(test_runner_module, "run_test", lambda *args, **kwargs: ran.append(args))

    with pytest.raises(SystemExit) as excinfo:
        test_runner_module.test()

    assert excinfo.value.code == 1
    assert ran == []


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
            attempt=1,
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
            attempt=1,
        ),
    ]

    output_file = test_runner_module.save_results(results, tmp_path / "outputs")
    data = json.loads(output_file.read_text())

    assert data["summary"]["total"] == 2
    assert [model["model"] for model in data["by_model"]] == ["openai:gpt-4.1", "anthropic:claude-4-5"]
    assert data["by_model"][0]["pass_rate"] == 100.0
    assert data["by_model"][1]["avg_duration_ms"] == 3000
    assert "pass_metrics" in data
    assert data["pass_metrics"]["k"] == 1
    assert set(data["pass_metrics"]["aggregate"].keys()) == {"pass_at_1", "pass_at_k", "pass_hat_k"}
    assert data["results"][0]["attempt"] == 1


def _case(name: str, **overrides) -> NaoTestCase:
    fields: dict[str, Any] = {
        "name": name,
        "prompt": "p",
        "file_path": Path(f"tests/{name}.yml"),
        "sql": "select 1",
        **overrides,
    }
    return NaoTestCase(**fields)


def _clarification_case() -> NaoTestCase:
    return _case(
        "ambiguous_revenue_period",
        prompt="What was the revenue?",
        sql=None,
        assertions=[ToolCallAssertion(tool="clarification")],
    )


def _revenue_case_asserting(tool: str) -> NaoTestCase:
    return _case("orders", prompt="total revenue", assertions=[ToolCallAssertion(tool=tool)])


def _agent_result(**overrides) -> AgentTestResult:
    fields: dict[str, Any] = {
        "text": "",
        "tool_calls": [],
        "usage": TokenUsage(totalTokens=0),
        "cost": TokenCost(totalCost=0),
        "finish_reason": "stop",
        "duration_ms": 1,
        **overrides,
    }
    return AgentTestResult(**fields)


def _stub_client(monkeypatch, result: AgentTestResult | None = None) -> Mock:
    client = Mock()
    client.run_test.return_value = result
    monkeypatch.setattr(test_runner_module, "get_client", lambda **_: client)
    return client


def _client_payload(monkeypatch, test_case: NaoTestCase, **run_options) -> dict:
    client, session = _client_answering(monkeypatch)

    client.run_test(test_case, **run_options)

    return session.post.call_args.kwargs["json"]


def _client_answering(monkeypatch, **response_fields) -> tuple[AgentClient, Mock]:
    response = Mock()
    response.status_code = 200
    response.json.return_value = {
        "text": "",
        "toolCalls": [],
        "usage": {"totalTokens": 0},
        "cost": {"totalCost": 0},
        "finishReason": "stop",
        **response_fields,
    }
    session = Mock()
    session.post.return_value = response
    client = AgentClient(backend_url="http://backend")
    monkeypatch.setattr(client, "_get_session", lambda: (session, 0))
    return client, session


def _capture_printed_tables(monkeypatch) -> list:
    tables: list = []
    monkeypatch.setattr(test_runner_module.UI, "table", lambda df, title=None, **kwargs: tables.append((title, df)))
    return tables
