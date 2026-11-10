"""Headless agent harnesses supported by `nao test`."""

from nao_core.config.test import TestHarnessConfig

from .base import HarnessError, HarnessRun, HeadlessHarness, McpConnection
from .claude_code import ClaudeCodeHarness
from .codex import CodexHarness


def create_harness(config: TestHarnessConfig) -> HeadlessHarness:
    """Create the configured local agent adapter."""
    harnesses: dict[str, type[HeadlessHarness]] = {
        "codex": CodexHarness,
        "claude-code": ClaudeCodeHarness,
    }
    harness = harnesses[config.name]
    return harness(config.model, config.reasoning_effort, config.timeout_seconds)


__all__ = ["HarnessError", "HarnessRun", "HeadlessHarness", "McpConnection", "create_harness"]
