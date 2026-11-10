import importlib
from pathlib import Path
from unittest.mock import Mock

import pytest

from nao_core.commands.test.case import TestCase as NaoTestCase
from nao_core.commands.test.client import (
    AgentClient,
    ExternalTestAttempt,
    ExternalVerificationRequest,
    TokenCost,
    TokenUsage,
)
from nao_core.commands.test.client import (
    TestResult as AgentTestResult,
)
from nao_core.commands.test.harnesses import HarnessRun
from nao_core.commands.test.runner import resolve_harness_config, run_external_harness_test
from nao_core.config.test import TestConfig, TestHarnessConfig


def response(data):
    return Mock(status_code=200, json=Mock(return_value=data))


def test_client_starts_an_external_attempt(monkeypatch):
    client = AgentClient(backend_url="http://backend")
    session = Mock()
    session.post.return_value = response(
        {
            "attemptId": "attempt-1",
            "mcpUrl": "https://nao.example/mcp/project-1",
            "accessToken": "secret",
        }
    )
    monkeypatch.setattr(client, "_get_session", lambda: (session, 0))

    attempt = client.start_external_test()

    assert attempt == ExternalTestAttempt("attempt-1", "https://nao.example/mcp/project-1", "secret")
    session.post.assert_called_once_with("http://backend/api/test/external/start", json={})


def test_client_round_trips_verification_sql(monkeypatch):
    client = AgentClient(backend_url="http://backend")
    session = Mock()
    session.post.side_effect = [
        response({"status": "verification_required", "prompt": "write SQL"}),
        response(
            {
                "status": "complete",
                "text": "10",
                "toolCalls": [],
                "usage": {"totalTokens": 3},
                "cost": {"totalCost": None},
                "finishReason": "stop",
                "durationMs": 5,
                "verdict": {"passed": True, "message": "match", "comparison": None},
            }
        ),
    ]
    monkeypatch.setattr(client, "_get_session", lambda: (session, 0))
    attempt = ExternalTestAttempt("attempt-1", "https://nao.example/mcp/project-1", "secret")
    test_case = NaoTestCase("revenue", "Revenue?", Path("tests/revenue.yml"), sql="select 10 as total")
    run = HarnessRun(text="10", usage={"totalTokens": 3}, cost={"totalCost": None}, duration_ms=5)

    pending = client.evaluate_external_test(attempt, test_case, run)
    complete = client.evaluate_external_test(attempt, test_case, run, verification_sql="select total from query_1")

    assert pending == ExternalVerificationRequest("write SQL")
    assert isinstance(complete, AgentTestResult)
    first_payload = session.post.call_args_list[0].kwargs["json"]
    second_payload = session.post.call_args_list[1].kwargs["json"]
    assert "verificationSql" not in first_payload
    assert second_payload["verificationSql"] == "select total from query_1"


def test_external_run_repairs_verification_once(monkeypatch):
    runner = importlib.import_module("nao_core.commands.test.runner")

    client = Mock()
    harness = Mock()
    run = HarnessRun(text="10", usage={"totalTokens": 3}, cost={"totalCost": None}, duration_ms=5)
    result = AgentTestResult(
        text="10",
        tool_calls=[],
        usage=TokenUsage(totalTokens=3),
        cost=TokenCost(totalCost=None),
        finish_reason="stop",
        duration_ms=5,
    )
    harness.run_agent.return_value = run
    harness.run_verifier.side_effect = ["bad SQL", "select total from query_1"]
    client.start_external_test.return_value = ExternalTestAttempt(
        "attempt-1", "https://nao.example/mcp/project-1", "secret"
    )
    client.evaluate_external_test.side_effect = [
        ExternalVerificationRequest("write SQL"),
        ExternalVerificationRequest("repair SQL"),
        result,
    ]
    monkeypatch.setattr(runner, "create_harness", lambda _config: harness)
    test_case = NaoTestCase("revenue", "Revenue?", Path("tests/revenue.yml"), sql="select 10 as total")

    actual = run_external_harness_test(client, TestHarnessConfig(name="codex"), test_case, None)

    assert actual is result
    assert harness.run_verifier.call_count == 2
    assert client.evaluate_external_test.call_count == 3


def test_harness_flags_override_the_config():
    config = TestConfig.model_validate({"harness": {"name": "codex", "model": "default", "timeout_seconds": 600}})

    resolved = resolve_harness_config(config, None, "gpt-5.3-codex", "high", 900, None)

    assert resolved == TestHarnessConfig(
        name="codex", model="gpt-5.3-codex", reasoning_effort="high", timeout_seconds=900
    )


def test_matching_harness_flag_preserves_configured_settings():
    config = TestConfig.model_validate({"harness": {"name": "codex", "model": "configured", "timeout_seconds": 900}})

    resolved = resolve_harness_config(config, "codex", None, None, None, None)

    assert resolved == TestHarnessConfig(name="codex", model="configured", timeout_seconds=900)


def test_nao_model_flag_is_rejected_with_a_harness():
    config = TestConfig.model_validate({"harness": "codex"})

    with pytest.raises(ValueError, match="--harness-model"):
        resolve_harness_config(config, None, None, None, None, ["openai:gpt-5"])
