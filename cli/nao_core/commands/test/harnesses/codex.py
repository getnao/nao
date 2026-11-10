"""Codex SDK headless harness."""

from __future__ import annotations

from typing import Any

from .base import (
    VERIFICATION_SCHEMA,
    HarnessError,
    HarnessRun,
    HeadlessHarness,
    McpConnection,
    agent_prompt,
    empty_cost,
    empty_workspace,
    load_harness_sdk,
    parse_json_object,
    verification_sql,
)


class CodexHarness(HeadlessHarness):
    """Run tests with the official Codex Python SDK."""

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
        sdk = load_harness_sdk("openai_codex", "harness-codex")
        config: dict[str, Any] = {
            "project_doc_max_bytes": 0,
            "shell_environment_policy": {"inherit": "none"},
            "mcp_servers": {},
        }
        if connection:
            config["mcp_servers"] = {
                "nao": {
                    "url": connection.url,
                    "http_headers": {"Authorization": f"Bearer {connection.access_token}"},
                    "required": True,
                    "default_tools_approval_mode": "auto",
                }
            }

        try:
            with empty_workspace() as workspace:
                async with sdk.AsyncCodex() as codex:
                    thread = await codex.thread_start(
                        approval_mode=sdk.ApprovalMode.deny_all,
                        config=config,
                        cwd=workspace,
                        ephemeral=True,
                        model=self.model,
                        sandbox=sdk.Sandbox.read_only,
                    )
                    result = await thread.run(
                        agent_prompt(prompt) if connection else prompt,
                        effort=self.reasoning_effort,
                        output_schema=output_schema,
                    )
        except HarnessError:
            raise
        except Exception as error:
            raise HarnessError(f"Codex SDK failed: {error}") from error

        if not result.final_response:
            detail = f": {result.error}" if result.error else ""
            raise HarnessError(f"Codex did not return a final response{detail}.")
        return HarnessRun(
            text=result.final_response,
            usage=normalize_codex_usage(result.usage),
            cost=empty_cost(),
            duration_ms=result.duration_ms or 0,
        )


def normalize_codex_usage(usage: Any) -> dict[str, int | None]:
    """Convert Codex's typed cumulative usage to nao's test result shape."""
    total = getattr(usage, "total", None)
    if total is None:
        return {}
    return {
        "inputTotalTokens": total.input_tokens,
        "inputNoCacheTokens": total.input_tokens - total.cached_input_tokens,
        "inputCacheReadTokens": total.cached_input_tokens,
        "inputCacheWriteTokens": total.cache_write_input_tokens,
        "outputTotalTokens": total.output_tokens,
        "outputTextTokens": total.output_tokens - total.reasoning_output_tokens,
        "outputReasoningTokens": total.reasoning_output_tokens,
        "totalTokens": total.total_tokens,
    }
