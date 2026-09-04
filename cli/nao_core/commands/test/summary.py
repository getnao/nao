"""Aggregation of test run results, shared by the CLI output and the results server."""

from collections import defaultdict
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
    k: int = 1
    pass_at_1: float = 0.0
    pass_at_k: float = 0.0
    pass_hat_k: float = 0.0


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


def group_by_test_and_model(runs: Runs) -> dict[tuple[str, str], list[Mapping[str, Any]]]:
    """Group runs by (test name, model)."""
    groups: dict[tuple[str, str], list[Mapping[str, Any]]] = defaultdict(list)
    for run in runs:
        name = str(run.get("name") or "")
        model = str(run.get("model") or UNKNOWN_MODEL)
        groups[(name, model)].append(run)
    return dict(groups)


def pass_metrics_for_group(runs: Runs) -> dict[str, float | int]:
    """Compute empirical pass@1 / pass@k / pass^k for one (test, model) group.

    Because nao test --k N runs exactly N attempts per test case (not an
    oversampled pool), these use the direct empirical definitions:

    - pass@1: mean of passed across the group's attempts
    - pass@k: 1.0 if any attempt passed, else 0.0
    - pass^k: 1.0 if all attempts passed, else 0.0
    """
    outcomes = [bool(run.get("passed")) for run in runs]
    k_count = len(outcomes)
    if k_count == 0:
        return {"k": 0, "pass_at_1": 0.0, "pass_at_k": 0.0, "pass_hat_k": 0.0}

    pass_at_1 = sum(1 for passed in outcomes if passed) / k_count
    pass_at_k = 1.0 if any(outcomes) else 0.0
    pass_hat_k = 1.0 if all(outcomes) else 0.0
    return {
        "k": k_count,
        "pass_at_1": pass_at_1,
        "pass_at_k": pass_at_k,
        "pass_hat_k": pass_hat_k,
    }


def summarize_pass_metrics(runs: Runs) -> dict[str, Any]:
    """Summarize pass@k metrics per (test, model) and as suite aggregates.

    Suite-level pass_at_1 / pass_at_k / pass_hat_k are means across test-case
    groups (not across raw attempts), so a case with k=5 counts once. A 75%
    per-trial success rate over many independent cases therefore averages
    pass^3 toward ~0.75^3 ≈ 42% at the suite level, even though each
    individual test case's pass^k is a hard 0-or-1.
    """
    groups = group_by_test_and_model(runs)
    by_test: list[dict[str, Any]] = []
    for (name, model), group_runs in sorted(groups.items(), key=lambda item: (item[0][0], item[0][1])):
        metrics = pass_metrics_for_group(group_runs)
        by_test.append(
            {
                "name": name,
                "model": model,
                "k": metrics["k"],
                "pass_at_1": metrics["pass_at_1"],
                "pass_at_k": metrics["pass_at_k"],
                "pass_hat_k": metrics["pass_hat_k"],
            }
        )

    k_count = max((int(item["k"]) for item in by_test), default=0)
    if by_test:
        # Mean across test-case groups (not raw attempts) — see docstring.
        aggregate = {
            "pass_at_1": sum(float(item["pass_at_1"]) for item in by_test) / len(by_test),
            "pass_at_k": sum(float(item["pass_at_k"]) for item in by_test) / len(by_test),
            "pass_hat_k": sum(float(item["pass_hat_k"]) for item in by_test) / len(by_test),
        }
    else:
        aggregate = {"pass_at_1": 0.0, "pass_at_k": 0.0, "pass_hat_k": 0.0}

    return {
        "k": k_count,
        "aggregate": aggregate,
        "by_test": by_test,
    }


def summarize_by_model(runs: Runs) -> list[ModelSummary]:
    """Aggregate runs per model, best pass rate first and cheapest as tie-breaker.

    Token/cost/duration totals still sum every attempt. pass_at_1 / pass_at_k /
    pass_hat_k average across test cases (each case counts once), matching
    summarize_pass_metrics.
    """
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

    # Pass@k metrics: group by test case first so k attempts count once.
    by_test = group_by_test_and_model(runs)
    per_test = [pass_metrics_for_group(group_runs) for group_runs in by_test.values()]
    n_tests = len(per_test)
    k_count = max((int(m["k"]) for m in per_test), default=0)
    if n_tests:
        pass_at_1 = sum(float(m["pass_at_1"]) for m in per_test) / n_tests
        pass_at_k = sum(float(m["pass_at_k"]) for m in per_test) / n_tests
        pass_hat_k = sum(float(m["pass_hat_k"]) for m in per_test) / n_tests
    else:
        pass_at_1 = pass_at_k = pass_hat_k = 0.0

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
        k=k_count,
        pass_at_1=pass_at_1,
        pass_at_k=pass_at_k,
        pass_hat_k=pass_hat_k,
    )


def _sum(runs: Runs, field: str) -> float:
    return sum(run.get(field) or 0 for run in runs)
