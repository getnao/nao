import importlib
import json
from pathlib import Path
from types import SimpleNamespace

from nao_core.commands.test.harnesses.base import McpConnection
from nao_core.commands.test.harnesses.claude_code import ClaudeCodeHarness, normalize_claude_usage
from nao_core.commands.test.harnesses.codex import CodexHarness, normalize_codex_usage

claude_code_module = importlib.import_module("nao_core.commands.test.harnesses.claude_code")
codex_module = importlib.import_module("nao_core.commands.test.harnesses.codex")


def test_codex_sdk_receives_scoped_mcp_configuration(monkeypatch):
    captured = {}
    usage = SimpleNamespace(
        total=SimpleNamespace(
            input_tokens=100,
            cached_input_tokens=20,
            cache_write_input_tokens=4,
            output_tokens=15,
            reasoning_output_tokens=5,
            total_tokens=115,
        )
    )

    class FakeThread:
        async def run(self, prompt, **options):
            captured["prompt"] = prompt
            captured["run_options"] = options
            return SimpleNamespace(final_response="answer", error=None, usage=usage, duration_ms=5)

    class FakeCodex:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *_args):
            return None

        async def thread_start(self, **options):
            captured["thread_options"] = options
            assert Path(options["cwd"]).is_dir()
            return FakeThread()

    sdk = SimpleNamespace(
        AsyncCodex=FakeCodex,
        ApprovalMode=SimpleNamespace(deny_all="deny_all"),
        Sandbox=SimpleNamespace(read_only="read-only"),
    )
    monkeypatch.setattr(codex_module, "load_harness_sdk", lambda *_args: sdk)
    harness = CodexHarness(model="gpt-codex", reasoning_effort="high", timeout_seconds=10)

    result = harness.run_agent("Revenue?", McpConnection("https://nao.example/mcp/project", "secret-token"))

    assert result.text == "answer"
    assert result.usage["inputNoCacheTokens"] == 80
    assert result.usage["outputReasoningTokens"] == 5
    assert captured["thread_options"]["model"] == "gpt-codex"
    assert captured["thread_options"]["sandbox"] == "read-only"
    nao_config = captured["thread_options"]["config"]["mcp_servers"]["nao"]
    assert nao_config["http_headers"] == {"Authorization": "Bearer secret-token"}
    assert nao_config["required"] is True
    assert captured["run_options"]["effort"] == "high"


def test_codex_verifier_uses_structured_output_without_mcp(monkeypatch):
    captured = {}

    class FakeThread:
        async def run(self, _prompt, **options):
            captured["run_options"] = options
            return SimpleNamespace(final_response='{"sql":"select 1"}', error=None, usage=None, duration_ms=3)

    class FakeCodex:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *_args):
            return None

        async def thread_start(self, **options):
            captured["thread_options"] = options
            return FakeThread()

    sdk = SimpleNamespace(
        AsyncCodex=FakeCodex,
        ApprovalMode=SimpleNamespace(deny_all="deny_all"),
        Sandbox=SimpleNamespace(read_only="read-only"),
    )
    monkeypatch.setattr(codex_module, "load_harness_sdk", lambda *_args: sdk)

    sql = CodexHarness(model=None, reasoning_effort=None, timeout_seconds=10).run_verifier("write SQL")

    assert sql == "select 1"
    assert captured["thread_options"]["config"]["mcp_servers"] == {}
    assert captured["run_options"]["output_schema"]["required"] == ["sql"]


def test_claude_sdk_receives_private_mcp_config(monkeypatch):
    captured = {}

    class FakeOptions:
        def __init__(self, **options):
            self.__dict__.update(options)
            captured["options"] = options

    class FakeResultMessage:
        def __init__(self):
            self.is_error = False
            self.result = "answer"
            self.structured_output = None
            self.errors = None
            self.usage = {"input_tokens": 10, "cache_read_input_tokens": 5, "output_tokens": 3}
            self.total_cost_usd = 0.012
            self.stop_reason = "end_turn"
            self.duration_ms = 5

    async def query(*, prompt, options):
        captured["prompt"] = prompt
        config_path = Path(options.mcp_servers)
        captured["config_path"] = config_path
        assert config_path.is_file()
        assert config_path.stat().st_mode & 0o777 == 0o600
        captured["mcp_config"] = json.loads(config_path.read_text())
        yield FakeResultMessage()

    sdk = SimpleNamespace(ClaudeAgentOptions=FakeOptions, ResultMessage=FakeResultMessage, query=query)
    monkeypatch.setattr(claude_code_module, "load_harness_sdk", lambda *_args: sdk)
    harness = ClaudeCodeHarness(model="sonnet", reasoning_effort="high", timeout_seconds=10)

    result = harness.run_agent("Revenue?", McpConnection("https://nao.example/mcp/project", "secret-token"))

    assert result.text == "answer"
    assert result.usage["totalTokens"] == 18
    assert result.cost["totalCost"] == 0.012
    assert captured["options"]["tools"] == []
    assert captured["options"]["setting_sources"] == []
    assert captured["options"]["allowed_tools"] == ["mcp__nao__*"]
    assert captured["mcp_config"]["mcpServers"]["nao"]["headers"] == {"Authorization": "Bearer secret-token"}
    assert not captured["config_path"].exists()


def test_claude_verifier_uses_structured_output_without_mcp(monkeypatch):
    captured = {}

    class FakeOptions:
        def __init__(self, **options):
            self.__dict__.update(options)
            captured.update(options)

    class FakeResultMessage:
        is_error = False
        result = None
        structured_output = {"sql": "select 1"}
        errors = None
        usage = None
        total_cost_usd = None
        stop_reason = "end_turn"
        duration_ms = 2

    async def query(*, prompt, options):
        yield FakeResultMessage()

    sdk = SimpleNamespace(ClaudeAgentOptions=FakeOptions, ResultMessage=FakeResultMessage, query=query)
    monkeypatch.setattr(claude_code_module, "load_harness_sdk", lambda *_args: sdk)

    sql = ClaudeCodeHarness(model=None, reasoning_effort=None, timeout_seconds=10).run_verifier("write SQL")

    assert sql == "select 1"
    assert captured["mcp_servers"] == {}
    assert captured["output_format"]["schema"]["required"] == ["sql"]


def test_usage_normalizers_accept_missing_usage():
    assert normalize_codex_usage(None) == {}
    assert normalize_claude_usage(None)["totalTokens"] is None
