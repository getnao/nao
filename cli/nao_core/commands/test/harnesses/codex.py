"""Codex CLI headless harness."""

import json
from pathlib import Path
from typing import Any

from .base import (
    VERIFICATION_SCHEMA,
    HarnessError,
    HarnessRun,
    HeadlessHarness,
    McpConnection,
    agent_prompt,
    base_environment,
    empty_workspace,
    parse_json_object,
    verification_sql,
)


class CodexHarness(HeadlessHarness):
    """Run tests with `codex exec` and an attempt-scoped nao MCP server."""

    executable = "codex"

    def run_agent(self, prompt: str, connection: McpConnection) -> HarnessRun:
        with empty_workspace() as workspace:
            env = base_environment()
            env["NAO_TEST_MCP_TOKEN"] = connection.access_token
            args = self._base_args() + [
                "-c",
                f"mcp_servers.nao.url={json.dumps(connection.url)}",
                "-c",
                'mcp_servers.nao.bearer_token_env_var="NAO_TEST_MCP_TOKEN"',
                "-c",
                "mcp_servers.nao.required=true",
                "-c",
                'mcp_servers.nao.default_tools_approval_mode="auto"',
                agent_prompt(prompt),
            ]
            stdout, _stderr, duration_ms = self._run(args, Path(workspace), env)
        text, usage = parse_codex_stream(stdout)
        return HarnessRun(text=text, usage=usage, cost=empty_cost(), duration_ms=duration_ms)

    def run_verifier(self, prompt: str) -> str | None:
        with empty_workspace() as workspace:
            schema_path = Path(workspace) / "verification-schema.json"
            schema_path.write_text(json.dumps(VERIFICATION_SCHEMA))
            args = self._base_args() + ["--output-schema", str(schema_path), prompt]
            stdout, _stderr, _duration_ms = self._run(args, Path(workspace), base_environment())
        text, _usage = parse_codex_stream(stdout)
        return verification_sql(parse_json_object(text))

    def _base_args(self) -> list[str]:
        args = [
            self._resolve_executable(),
            "exec",
            "--json",
            "--ephemeral",
            "--ignore-user-config",
            "--ignore-rules",
            "--strict-config",
            "-c",
            'shell_environment_policy.inherit="none"',
            "--sandbox",
            "read-only",
            "--skip-git-repo-check",
        ]
        if self.model:
            args.extend(["--model", self.model])
        if self.reasoning_effort:
            args.extend(["-c", f"model_reasoning_effort={json.dumps(self.reasoning_effort)}"])
        return args


def parse_codex_stream(output: str) -> tuple[str, dict[str, int | None]]:
    """Extract the final agent message and token counts from Codex JSONL output."""
    text = ""
    usage: dict[str, int | None] = {}
    errors: list[str] = []
    for line in output.splitlines():
        if not line.strip():
            continue
        try:
            event = json.loads(line)
        except json.JSONDecodeError as error:
            raise HarnessError(f"Codex returned invalid JSONL: {line[:500]}") from error
        if not isinstance(event, dict):
            continue
        if event.get("type") == "item.completed":
            item = event.get("item")
            if isinstance(item, dict) and item.get("type") == "agent_message" and isinstance(item.get("text"), str):
                text = item["text"]
        elif event.get("type") == "turn.completed" and isinstance(event.get("usage"), dict):
            usage = normalize_codex_usage(event["usage"])
        elif event.get("type") in {"error", "turn.failed"}:
            errors.append(describe_codex_error(event))
    if not text:
        details = f" ({'; '.join(errors)})" if errors else ""
        raise HarnessError(f"Codex did not return a final agent message{details}.")
    return text, usage


def normalize_codex_usage(usage: dict[str, Any]) -> dict[str, int | None]:
    input_tokens = as_int(usage.get("input_tokens"))
    cached_tokens = as_int(usage.get("cached_input_tokens"))
    output_tokens = as_int(usage.get("output_tokens"))
    return {
        "inputTotalTokens": input_tokens,
        "inputNoCacheTokens": input_tokens - cached_tokens
        if input_tokens is not None and cached_tokens is not None
        else None,
        "inputCacheReadTokens": cached_tokens,
        "inputCacheWriteTokens": None,
        "outputTotalTokens": output_tokens,
        "outputTextTokens": None,
        "outputReasoningTokens": None,
        "totalTokens": input_tokens + output_tokens if input_tokens is not None and output_tokens is not None else None,
    }


def describe_codex_error(event: dict[str, Any]) -> str:
    error = event.get("error")
    if isinstance(error, dict) and isinstance(error.get("message"), str):
        return error["message"]
    return str(event.get("message") or event.get("type"))


def as_int(value: object) -> int | None:
    return value if isinstance(value, int) and not isinstance(value, bool) else None


def empty_cost() -> dict[str, float | None]:
    return {
        "inputNoCache": None,
        "inputCacheRead": None,
        "inputCacheWrite": None,
        "output": None,
        "totalCost": None,
    }
