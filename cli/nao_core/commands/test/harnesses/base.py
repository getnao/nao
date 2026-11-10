"""Shared types and helpers for headless test harnesses."""

from __future__ import annotations

import asyncio
import importlib
import json
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from tempfile import TemporaryDirectory
from typing import Any

from nao_core.deps import MissingDependencyError, require_dependency

VERIFICATION_SCHEMA = {
    "type": "object",
    "properties": {"sql": {"type": ["string", "null"]}},
    "required": ["sql"],
    "additionalProperties": False,
}


@dataclass(frozen=True)
class McpConnection:
    """Attempt-scoped MCP endpoint handed to a harness."""

    url: str
    access_token: str


@dataclass
class HarnessRun:
    """Normalized output from a headless agent SDK."""

    text: str
    usage: dict[str, int | None] = field(default_factory=dict)
    cost: dict[str, float | None] = field(default_factory=dict)
    finish_reason: str = "stop"
    duration_ms: int = 0


class HarnessError(RuntimeError):
    """A headless agent could not start or did not return a usable result."""


class HeadlessHarness:
    """Base class for an agent SDK used as a nao test harness."""

    def __init__(self, model: str | None, reasoning_effort: str | None, timeout_seconds: int):
        self.model = model
        self.reasoning_effort = reasoning_effort
        self.timeout_seconds = timeout_seconds

    def run_agent(self, prompt: str, connection: McpConnection) -> HarnessRun:
        raise NotImplementedError

    def run_verifier(self, prompt: str) -> str | None:
        raise NotImplementedError

    def _run_async(self, task: Callable[[], Awaitable[Any]]) -> Any:
        async def run_with_timeout():
            return await asyncio.wait_for(task(), timeout=self.timeout_seconds)

        try:
            return asyncio.run(run_with_timeout())
        except TimeoutError as error:
            raise HarnessError(f"Harness timed out after {self.timeout_seconds} seconds.") from error


def load_harness_sdk(package: str, extra: str) -> Any:
    """Load an optional agent SDK and return an actionable installation error."""
    try:
        require_dependency(package, extra, "to run this test harness")
    except MissingDependencyError as error:
        raise HarnessError(str(error)) from error
    return importlib.import_module(package)


def agent_prompt(prompt: str) -> str:
    """Tell a generic agent to answer with the isolated nao MCP server."""
    return f"""Answer the user's data question using the nao MCP tools available in this session.
Read the nao context before querying, follow its business definitions, and use the query tools for factual values.
Do not inspect the local filesystem or use outside data sources.

User question:
{prompt}"""


def empty_workspace() -> TemporaryDirectory:
    """Return an empty working directory so repository instructions do not affect the harness."""
    return TemporaryDirectory(prefix="nao-test-harness-")


def parse_json_object(text: str) -> dict[str, Any]:
    """Parse a structured agent response."""
    try:
        value = json.loads(text.strip())
    except json.JSONDecodeError as error:
        raise HarnessError(f"Verifier returned invalid JSON: {text[:500]}") from error
    if not isinstance(value, dict):
        raise HarnessError("Verifier response must be a JSON object.")
    return value


def verification_sql(value: dict[str, Any]) -> str | None:
    """Validate the one-field response shared by all verifier adapters."""
    sql = value.get("sql")
    if sql is not None and not isinstance(sql, str):
        raise HarnessError("Verifier field 'sql' must be a string or null.")
    return sql


def empty_cost() -> dict[str, float | None]:
    return {
        "inputNoCache": None,
        "inputCacheRead": None,
        "inputCacheWrite": None,
        "output": None,
        "totalCost": None,
    }
