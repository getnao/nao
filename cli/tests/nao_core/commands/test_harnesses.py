import json
from pathlib import Path

import pytest

from nao_core.commands.test.harnesses import HarnessError
from nao_core.commands.test.harnesses.base import McpConnection
from nao_core.commands.test.harnesses.claude_code import ClaudeCodeHarness, parse_claude_stream
from nao_core.commands.test.harnesses.codex import CodexHarness, parse_codex_stream


def test_parse_codex_stream_returns_the_last_agent_message_and_usage():
    output = "\n".join(
        [
            json.dumps({"type": "item.completed", "item": {"type": "agent_message", "text": "draft"}}),
            json.dumps({"type": "item.completed", "item": {"type": "agent_message", "text": "answer"}}),
            json.dumps(
                {
                    "type": "turn.completed",
                    "usage": {"input_tokens": 100, "cached_input_tokens": 20, "output_tokens": 15},
                }
            ),
        ]
    )

    text, usage = parse_codex_stream(output)

    assert text == "answer"
    assert usage["inputNoCacheTokens"] == 80
    assert usage["inputCacheReadTokens"] == 20
    assert usage["totalTokens"] == 115


def test_parse_codex_stream_rejects_a_missing_final_message():
    with pytest.raises(HarnessError, match="did not return a final agent message"):
        parse_codex_stream(json.dumps({"type": "turn.completed", "usage": {}}))


def test_parse_claude_stream_returns_text_usage_and_cost():
    output = json.dumps(
        {
            "type": "result",
            "result": "answer",
            "usage": {
                "input_tokens": 10,
                "cache_read_input_tokens": 5,
                "cache_creation_input_tokens": 2,
                "output_tokens": 3,
            },
            "total_cost_usd": 0.012,
        }
    )

    text, usage, cost = parse_claude_stream(output)

    assert text == "answer"
    assert usage["inputTotalTokens"] == 17
    assert usage["totalTokens"] == 20
    assert cost["totalCost"] == 0.012


def test_parse_claude_stream_prefers_structured_output():
    output = json.dumps({"type": "result", "result": "ignored", "structured_output": {"sql": "select 1"}})

    text, _usage, _cost = parse_claude_stream(output)

    assert json.loads(text) == {"sql": "select 1"}


def test_codex_keeps_the_mcp_token_out_of_arguments_and_child_shells(monkeypatch):
    harness = CodexHarness(model=None, reasoning_effort=None, timeout_seconds=10)
    monkeypatch.setattr(harness, "_resolve_executable", lambda: "codex")

    def run(args, _cwd, env):
        assert "secret-token" not in " ".join(args)
        assert env["NAO_TEST_MCP_TOKEN"] == "secret-token"
        assert 'shell_environment_policy.inherit="none"' in args
        assert "mcp_servers.nao.required=true" in args
        assert 'mcp_servers.nao.default_tools_approval_mode="auto"' in args
        output = json.dumps({"type": "item.completed", "item": {"type": "agent_message", "text": "answer"}})
        return output, "", 5

    monkeypatch.setattr(harness, "_run", run)

    result = harness.run_agent("Revenue?", McpConnection("https://nao.example/mcp/project", "secret-token"))

    assert result.text == "answer"


def test_claude_keeps_credential_config_outside_the_readable_workspace(monkeypatch):
    harness = ClaudeCodeHarness(model=None, reasoning_effort=None, timeout_seconds=10)
    monkeypatch.setattr(harness, "_resolve_executable", lambda: "claude")

    def run(args, cwd, _env):
        config_path = args[args.index("--mcp-config") + 1]
        assert not config_path.startswith(str(cwd))
        assert "secret-token" in Path(config_path).read_text()
        assert args[args.index("--allowedTools") + 1] == "mcp__nao__*"
        return json.dumps({"type": "result", "result": "answer"}), "", 5

    monkeypatch.setattr(harness, "_run", run)

    result = harness.run_agent("Revenue?", McpConnection("https://nao.example/mcp/project", "secret-token"))

    assert result.text == "answer"
