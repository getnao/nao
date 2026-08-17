"""Extensible action/step assertions for `nao test`.

Assertions check intermediate agent behavior (tool calls, steps) independently
of final-output dataframe verification.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, cast


class AssertionConfigError(ValueError):
    """Raised when an assertion definition in a test YAML is invalid."""


@dataclass(frozen=True)
class ToolCallAssertion:
    """Require that a named tool was invoked during the agentic loop.

    Optional ``args`` values must appear as a subset of the tool call's args
    (nested dicts are matched recursively; lists require equality).
    """

    tool: str
    args: dict[str, Any] | None = None
    min_count: int = 1

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> ToolCallAssertion:
        tool = data.get("tool")
        if not isinstance(tool, str) or not tool.strip():
            raise AssertionConfigError("tool_call assertion requires a non-empty 'tool' string")

        args = data.get("args")
        if args is not None and not isinstance(args, dict):
            raise AssertionConfigError("tool_call assertion 'args' must be a mapping when provided")

        min_count = data.get("min_count", 1)
        if not isinstance(min_count, int) or isinstance(min_count, bool) or min_count < 1:
            raise AssertionConfigError("tool_call assertion 'min_count' must be an integer >= 1")

        unknown = set(data) - {"type", "tool", "args", "min_count"}
        if unknown:
            raise AssertionConfigError(f"unknown tool_call assertion fields: {sorted(unknown)}")

        return cls(tool=tool.strip(), args=args, min_count=min_count)


Assertion = ToolCallAssertion


def parse_assertions(raw: Any) -> list[Assertion]:
    """Parse the optional ``assertions`` list from a test YAML document."""
    if raw is None:
        return []
    if not isinstance(raw, list):
        raise AssertionConfigError("'assertions' must be a list")

    assertions: list[Assertion] = []
    for index, item in enumerate(raw):
        if not isinstance(item, dict):
            raise AssertionConfigError(f"assertions[{index}] must be a mapping")
        entry = cast(dict[str, Any], item)
        assertion_type = entry.get("type")
        if assertion_type == "tool_call":
            assertions.append(ToolCallAssertion.from_dict(entry))
        elif assertion_type is None:
            raise AssertionConfigError(f"assertions[{index}] is missing 'type'")
        else:
            raise AssertionConfigError(f"assertions[{index}] has unknown type {assertion_type!r}; supported: tool_call")
    return assertions


def _args_match(expected: Any, actual: Any) -> bool:
    """Return True when ``expected`` is a subset of ``actual`` (dicts recursive)."""
    if isinstance(expected, dict):
        if not isinstance(actual, dict):
            return False
        return all(key in actual and _args_match(value, actual[key]) for key, value in expected.items())
    return expected == actual


def evaluate_tool_call_assertion(
    assertion: ToolCallAssertion,
    tool_calls: list[dict[str, Any]] | None,
) -> tuple[bool, str]:
    """Evaluate a single tool_call assertion against recorded tool calls."""
    calls = tool_calls or []
    matches = [
        call
        for call in calls
        if call.get("toolName") == assertion.tool
        and (assertion.args is None or _args_match(assertion.args, call.get("args") or {}))
    ]
    count = len(matches)
    if count >= assertion.min_count:
        if assertion.min_count == 1 and assertion.args is None:
            return True, f"tool_call: {assertion.tool}"
        detail = f"tool_call: {assertion.tool} (x{count}"
        if assertion.min_count > 1:
            detail += f", min {assertion.min_count}"
        if assertion.args is not None:
            detail += ", args matched"
        detail += ")"
        return True, detail

    if assertion.args is not None:
        same_tool = sum(1 for call in calls if call.get("toolName") == assertion.tool)
        if same_tool:
            return (
                False,
                f"missing tool_call: {assertion.tool} with args {assertion.args} "
                f"(found {same_tool} call(s) without matching args)",
            )
        return False, f"missing tool_call: {assertion.tool} with args {assertion.args}"

    if assertion.min_count > 1:
        return (
            False,
            f"missing tool_call: {assertion.tool} (found {count}, need >= {assertion.min_count})",
        )
    return False, f"missing tool_call: {assertion.tool}"


def evaluate_assertions(
    assertions: list[Assertion],
    tool_calls: list[dict[str, Any]] | None,
) -> tuple[bool, str]:
    """Evaluate all assertions. Returns (passed, combined message)."""
    if not assertions:
        return True, ""

    messages: list[str] = []
    all_passed = True
    for assertion in assertions:
        if isinstance(assertion, ToolCallAssertion):
            passed, message = evaluate_tool_call_assertion(assertion, tool_calls)
        else:  # pragma: no cover - exhaustive for current Assertion union
            passed, message = False, f"unsupported assertion: {assertion!r}"
        messages.append(message)
        all_passed = all_passed and passed

    return all_passed, "; ".join(messages)


def combine_check_messages(*parts: str) -> str:
    """Join non-empty check messages with '; '."""
    return "; ".join(part for part in parts if part)
