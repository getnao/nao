"""Claude Code headless harness."""

import json
import os
from pathlib import Path
from typing import Any, cast

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
    private_config_directory,
    verification_sql,
)


class ClaudeCodeHarness(HeadlessHarness):
    """Run tests with `claude -p` and an attempt-scoped nao MCP server."""

    executable = "claude"

    def run_agent(self, prompt: str, connection: McpConnection) -> HarnessRun:
        with empty_workspace() as workspace, private_config_directory() as config_directory:
            config_path = Path(config_directory) / "mcp.json"
            config_path.write_text(
                json.dumps(
                    {
                        "mcpServers": {
                            "nao": {
                                "type": "http",
                                "url": connection.url,
                                "headers": {"Authorization": f"Bearer {connection.access_token}"},
                            }
                        }
                    }
                )
            )
            os.chmod(config_path, 0o600)
            args = self._base_args() + [
                "--mcp-config",
                str(config_path),
                "--strict-mcp-config",
                "--allowedTools",
                "mcp__nao__*",
                agent_prompt(prompt),
            ]
            stdout, _stderr, duration_ms = self._run(args, Path(workspace), base_environment())
        text, usage, cost = parse_claude_stream(stdout)
        return HarnessRun(text=text, usage=usage, cost=cost, duration_ms=duration_ms)

    def run_verifier(self, prompt: str) -> str | None:
        with empty_workspace() as workspace, private_config_directory() as config_directory:
            empty_config = Path(config_directory) / "mcp.json"
            empty_config.write_text('{"mcpServers":{}}')
            args = self._base_args() + [
                "--mcp-config",
                str(empty_config),
                "--strict-mcp-config",
                "--json-schema",
                json.dumps(VERIFICATION_SCHEMA),
                prompt,
            ]
            stdout, _stderr, _duration_ms = self._run(args, Path(workspace), base_environment())
        text, _usage, _cost = parse_claude_stream(stdout)
        return verification_sql(parse_json_object(text))

    def _base_args(self) -> list[str]:
        args = [
            self._resolve_executable(),
            "-p",
            "--output-format",
            "stream-json",
            "--verbose",
            "--no-session-persistence",
            "--restricted",
            "--permission-mode",
            "dontAsk",
            "--permission-prompts",
            "none",
        ]
        if self.model:
            args.extend(["--model", self.model])
        if self.reasoning_effort:
            args.extend(["--effort", self.reasoning_effort])
        return args


def parse_claude_stream(output: str) -> tuple[str, dict[str, int | None], dict[str, float | None]]:
    """Extract the result, usage and reported cost from Claude Code stream JSON."""
    result_event: dict[str, Any] | None = None
    for line in output.splitlines():
        if not line.strip():
            continue
        try:
            event = json.loads(line)
        except json.JSONDecodeError as error:
            raise HarnessError(f"Claude Code returned invalid JSONL: {line[:500]}") from error
        if isinstance(event, dict) and event.get("type") == "result":
            result_event = event
    if result_event is None:
        raise HarnessError("Claude Code did not return a result event.")
    if result_event.get("is_error"):
        raise HarnessError(f"Claude Code failed: {result_event.get('result') or 'unknown error'}")

    structured = result_event.get("structured_output")
    if isinstance(structured, dict):
        text = json.dumps(structured)
    else:
        raw_result = result_event.get("result")
        if not isinstance(raw_result, str):
            raise HarnessError("Claude Code result did not contain text.")
        text = raw_result

    usage = normalize_claude_usage(result_event.get("usage"))
    total_cost = result_event.get("total_cost_usd")
    cost = {
        "inputNoCache": None,
        "inputCacheRead": None,
        "inputCacheWrite": None,
        "output": None,
        "totalCost": float(total_cost) if isinstance(total_cost, (int, float)) else None,
    }
    return text, usage, cost


def normalize_claude_usage(value: object) -> dict[str, int | None]:
    usage = cast(dict[str, Any], value) if isinstance(value, dict) else {}
    input_tokens = as_int(usage.get("input_tokens"))
    cache_read = as_int(usage.get("cache_read_input_tokens"))
    cache_write = as_int(usage.get("cache_creation_input_tokens"))
    output_tokens = as_int(usage.get("output_tokens"))
    total_input = sum(token or 0 for token in (input_tokens, cache_read, cache_write))
    return {
        "inputTotalTokens": total_input,
        "inputNoCacheTokens": input_tokens,
        "inputCacheReadTokens": cache_read,
        "inputCacheWriteTokens": cache_write,
        "outputTotalTokens": output_tokens,
        "outputTextTokens": None,
        "outputReasoningTokens": None,
        "totalTokens": total_input + output_tokens if output_tokens is not None else None,
    }


def as_int(value: object) -> int | None:
    return value if isinstance(value, int) and not isinstance(value, bool) else None
