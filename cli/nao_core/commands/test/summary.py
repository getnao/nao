"""Aggregation of test run results, shared by the CLI output and the results server."""

from collections.abc import Mapping, Sequence
from dataclasses import asdict, dataclass
from typing import Any

Runs = Sequence[Mapping[str, Any]]

UNKNOWN_MODEL = "unknown"


@dataclass
class ModelSummary:
    """Aggregated performance of a single model across the runs it was used for."""

    model: str
    total: int
    passed: int
    failed: int
    pass_rate: float
    total_tokens: int
    total_cost: float
    total_duration_ms: int
    avg_duration_ms: float
    total_tool_calls: int
    avg_tool_calls: float


def summarize(runs: Runs) -> dict[str, Any]:
    """Aggregate every run, regardless of the model that produced it."""
    total = len(runs)
    total_duration_ms = _sum(runs, "duration_ms")
    total_tool_calls = _sum(runs, "tool_call_count")
    passed = sum(1 for run in runs if run.get("passed"))

    return {
        "total": total,
        "passed": passed,
        "failed": total - passed,
        "total_tokens": _sum(runs, "tokens"),
        "total_cost": _sum(runs, "cost"),
        "total_duration_ms": total_duration_ms,
        "total_duration_s": round(total_duration_ms / 1000, 2),
        "total_tool_calls": total_tool_calls,
        "avg_duration_ms": round(total_duration_ms / total, 0) if total else 0,
        "avg_tool_calls": round(total_tool_calls / total, 1) if total else 0,
    }


def summarize_by_model(runs: Runs) -> list[ModelSummary]:
    """Aggregate runs per model, best pass rate first and cheapest as tie-breaker."""
    grouped: dict[str, list[Mapping[str, Any]]] = {}
    for run in runs:
        grouped.setdefault(str(run.get("model") or UNKNOWN_MODEL), []).append(run)

    summaries = [_summarize_model(model, model_runs) for model, model_runs in grouped.items()]
    return sorted(summaries, key=lambda summary: (-summary.pass_rate, summary.total_cost, summary.model))


def with_model_summaries(data: dict[str, Any]) -> dict[str, Any]:
    """Backfill `by_model` for result files written before per-model summaries existed."""
    if data.get("by_model"):
        return data
    return {**data, "by_model": [asdict(summary) for summary in summarize_by_model(data.get("results") or [])]}


def _summarize_model(model: str, runs: Runs) -> ModelSummary:
    total = len(runs)
    passed = sum(1 for run in runs if run.get("passed"))
    total_duration_ms = _sum(runs, "duration_ms")
    total_tool_calls = _sum(runs, "tool_call_count")

    return ModelSummary(
        model=model,
        total=total,
        passed=passed,
        failed=total - passed,
        pass_rate=round(passed / total * 100, 1) if total else 0.0,
        total_tokens=int(_sum(runs, "tokens")),
        total_cost=round(_sum(runs, "cost"), 6),
        total_duration_ms=int(total_duration_ms),
        avg_duration_ms=round(total_duration_ms / total, 0) if total else 0.0,
        total_tool_calls=int(total_tool_calls),
        avg_tool_calls=round(total_tool_calls / total, 1) if total else 0.0,
    )


def _sum(runs: Runs, field: str) -> float:
    return sum(run.get(field) or 0 for run in runs)
