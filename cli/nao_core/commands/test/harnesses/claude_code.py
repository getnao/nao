"""Claude Agent SDK headless harness."""

from __future__ import annotations

import json
import os
from pathlib import Path
from tempfile import TemporaryDirectory
from typing import Any, cast

from .base import (
    VERIFICATION_SCHEMA,
    HarnessError,
    HarnessRun,
    HeadlessHarness,
    McpConnection,
    agent_prompt,
    empty_workspace,
    load_harness_sdk,
    parse_json_object,
    verification_sql,
)


class ClaudeCodeHarness(HeadlessHarness):
    """Run tests with the official Claude Agent SDK."""

    def run_agent(self, prompt: str, connection: McpConnection) -> HarnessRun:
        return self._run_async(lambda: self._run(prompt, connection=connection))

    def run_verifier(self, prompt: str) -> str | None:
        run = self._run_async(lambda: self._run(prompt, output_schema=VERIFICATION_SCHEMA))
        return verification_sql(parse_json_object(run.text))

    async def _run(
        self,
        prompt: str,
        connection: McpConnection | None = None,
        output_schema: dict[str, Any] | None = None,
    ) -> HarnessRun:
        sdk = load_harness_sdk("claude_agent_sdk", "harness-claude-code")
        try:
            with empty_workspace() as workspace, TemporaryDirectory(prefix="nao-test-harness-config-") as config_dir:
                mcp_config = self._write_mcp_config(Path(config_dir), connection) if connection else {}
                options = sdk.ClaudeAgentOptions(
                    tools=[],
                    allowed_tools=["mcp__nao__*"] if connection else [],
                    mcp_servers=mcp_config,
                    strict_mcp_config=True,
                    permission_mode="dontAsk",
                    cwd=workspace,
                    setting_sources=[],
                    skills=[],
                    model=self.model,
                    effort=cast(Any, self.reasoning_effort),
                    output_format={"type": "json_schema", "schema": output_schema} if output_schema else None,
                    extra_args={"no-session-persistence": None},
                )
                result = None
                async for message in sdk.query(
                    prompt=agent_prompt(prompt) if connection else prompt,
                    options=options,
                ):
                    if isinstance(message, sdk.ResultMessage):
                        result = message
        except HarnessError:
            raise
        except Exception as error:
            raise HarnessError(f"Claude Agent SDK failed: {error}") from error

        if result is None:
            raise HarnessError("Claude Agent SDK did not return a result.")
        if result.is_error:
            detail = result.result or "; ".join(result.errors or []) or "unknown error"
            raise HarnessError(f"Claude Agent SDK failed: {detail}")
        text = json.dumps(result.structured_output) if result.structured_output is not None else result.result
        if not isinstance(text, str):
            raise HarnessError("Claude Agent SDK did not return text.")
        return HarnessRun(
            text=text,
            usage=normalize_claude_usage(result.usage),
            cost=claude_cost(result.total_cost_usd),
            finish_reason=result.stop_reason or "stop",
            duration_ms=result.duration_ms,
        )

    @staticmethod
    def _write_mcp_config(config_dir: Path, connection: McpConnection) -> Path:
        path = config_dir / "mcp.json"
        path.write_text(
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
        os.chmod(path, 0o600)
        return path


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


def claude_cost(total_cost: object) -> dict[str, float | None]:
    return {
        "inputNoCache": None,
        "inputCacheRead": None,
        "inputCacheWrite": None,
        "output": None,
        "totalCost": float(total_cost) if isinstance(total_cost, (int, float)) else None,
    }


def as_int(value: object) -> int | None:
    return value if isinstance(value, int) and not isinstance(value, bool) else None
