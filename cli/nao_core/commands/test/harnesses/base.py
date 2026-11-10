"""Shared types and process helpers for headless test harnesses."""

import json
import os
import shutil
import subprocess
import time
from dataclasses import dataclass, field
from pathlib import Path
from tempfile import TemporaryDirectory
from typing import Any

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
    """Normalized output from a headless agent CLI."""

    text: str
    usage: dict[str, int | None] = field(default_factory=dict)
    cost: dict[str, float | None] = field(default_factory=dict)
    finish_reason: str = "stop"
    duration_ms: int = 0


class HarnessError(RuntimeError):
    """A headless agent could not be started or did not return a usable result."""


class HeadlessHarness:
    """Base class for a local agent CLI used as a nao test harness."""

    executable: str

    def __init__(self, model: str | None, reasoning_effort: str | None, timeout_seconds: int):
        self.model = model
        self.reasoning_effort = reasoning_effort
        self.timeout_seconds = timeout_seconds

    def run_agent(self, prompt: str, connection: McpConnection) -> HarnessRun:
        raise NotImplementedError

    def run_verifier(self, prompt: str) -> str | None:
        raise NotImplementedError

    def _resolve_executable(self) -> str:
        executable = shutil.which(self.executable)
        if not executable:
            raise HarnessError(
                f"The {self.executable!r} executable was not found. Install it and authenticate it before running tests."
            )
        return executable

    def _run(self, args: list[str], cwd: Path, env: dict[str, str] | None = None) -> tuple[str, str, int]:
        started = time.monotonic()
        try:
            result = subprocess.run(
                args,
                cwd=cwd,
                env=env,
                text=True,
                capture_output=True,
                timeout=self.timeout_seconds,
                check=False,
            )
        except subprocess.TimeoutExpired as error:
            raise HarnessError(f"Harness timed out after {self.timeout_seconds} seconds.") from error
        except OSError as error:
            raise HarnessError(f"Could not start the harness: {error}") from error

        duration_ms = round((time.monotonic() - started) * 1000)
        if result.returncode != 0:
            details = (result.stderr or result.stdout).strip()
            if len(details) > 2_000:
                details = f"{details[:1_000]}\n…\n{details[-1_000:]}"
            raise HarnessError(f"Harness exited with code {result.returncode}: {details or 'no error output'}")
        return result.stdout, result.stderr, duration_ms


def agent_prompt(prompt: str) -> str:
    """Tell a generic coding agent to answer with the isolated nao MCP server."""
    return f"""Answer the user's data question using the nao MCP tools available in this session.
Read the nao context before querying, follow its business definitions, and use the query tools for factual values.
Do not inspect the local filesystem or use outside data sources.

User question:
{prompt}"""


def empty_workspace() -> TemporaryDirectory[str]:
    """Return an isolated working directory so repository files cannot affect the harness."""
    return TemporaryDirectory(prefix="nao-test-harness-")


def private_config_directory() -> TemporaryDirectory[str]:
    """Keep credential-bearing config outside the agent's readable workspace."""
    return TemporaryDirectory(prefix="nao-test-harness-config-")


def base_environment() -> dict[str, str]:
    """Copy the environment without changing the harness's normal authentication store."""
    return os.environ.copy()


def parse_json_object(text: str) -> dict[str, Any]:
    """Parse a structured agent response, tolerating a fenced JSON block."""
    candidate = text.strip()
    if candidate.startswith("```"):
        lines = candidate.splitlines()
        if len(lines) >= 3 and lines[-1].strip() == "```":
            candidate = "\n".join(lines[1:-1])
            if candidate.lstrip().startswith("json"):
                candidate = candidate.lstrip()[4:].lstrip()
    try:
        value = json.loads(candidate)
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
