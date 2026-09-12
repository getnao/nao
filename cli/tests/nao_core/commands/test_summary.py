from nao_core.commands.test.summary import (
    group_by_test_and_model,
    pass_metrics_for_group,
    summarize,
    summarize_by_model,
    summarize_pass_metrics,
    with_model_summaries,
)


def run(model: str, passed: bool, **overrides) -> dict:
    return {
        "name": overrides.get("name", "orders"),
        "model": model,
        "passed": passed,
        "message": "match" if passed else "values differ",
        "tokens": overrides.get("tokens", 100),
        "cost": overrides.get("cost", 0.01),
        "duration_ms": overrides.get("duration_ms", 2000),
        "tool_call_count": overrides.get("tool_call_count", 3),
        **{
            key: value
            for key, value in overrides.items()
            if key not in {"name", "tokens", "cost", "duration_ms", "tool_call_count"}
        },
    }


def test_summarize_aggregates_every_run():
    summary = summarize([run("openai:gpt-4.1", True), run("anthropic:claude-sonnet-4-5", False)])

    assert summary["total"] == 2
    assert summary["passed"] == 1
    assert summary["failed"] == 1
    assert summary["total_tokens"] == 200
    assert summary["total_duration_s"] == 4.0
    assert summary["avg_tool_calls"] == 3.0


def test_summarize_by_model_groups_runs_per_model():
    runs = [
        run("openai:gpt-4.1", True, name="orders"),
        run("openai:gpt-4.1", False, name="users"),
        run("anthropic:claude-sonnet-4-5", True, name="orders", tokens=50, duration_ms=1000),
        run("anthropic:claude-sonnet-4-5", True, name="users", tokens=50, duration_ms=3000),
    ]

    summaries = summarize_by_model(runs)

    assert [s.model for s in summaries] == ["anthropic:claude-sonnet-4-5", "openai:gpt-4.1"]
    best, worst = summaries
    assert (best.passed, best.failed, best.pass_rate) == (2, 0, 100.0)
    assert best.total_tokens == 100
    assert best.avg_duration_ms == 2000
    assert (worst.passed, worst.failed, worst.pass_rate) == (1, 1, 50.0)


def test_summarize_by_model_ranks_the_cheapest_model_first_on_equal_pass_rates():
    runs = [
        run("openai:gpt-4.1", True, cost=0.5),
        run("anthropic:claude-sonnet-4-5", True, cost=0.1),
    ]

    assert [s.model for s in summarize_by_model(runs)] == ["anthropic:claude-sonnet-4-5", "openai:gpt-4.1"]


def test_summarize_by_model_handles_runs_without_metrics():
    summaries = summarize_by_model([{"name": "orders", "model": "openai:gpt-4.1", "passed": False}])

    assert summaries[0].total_tokens == 0
    assert summaries[0].avg_duration_ms == 0
    assert summaries[0].pass_rate == 0.0


def test_with_model_summaries_backfills_older_result_files():
    data = {"results": [run("openai:gpt-4.1", True), run("openai:gpt-4.1", False)], "summary": {"total": 2}}

    backfilled = with_model_summaries(data)

    assert [s["model"] for s in backfilled["by_model"]] == ["openai:gpt-4.1"]
    assert backfilled["by_model"][0]["pass_rate"] == 50.0


def test_with_model_summaries_keeps_existing_summaries():
    data = {"results": [run("openai:gpt-4.1", True)], "by_model": [{"model": "kept"}]}

    assert with_model_summaries(data)["by_model"] == [{"model": "kept"}]


def test_pass_metrics_partial_group():
    runs = [
        run("openai:gpt-4.1", True),
        run("openai:gpt-4.1", True),
        run("openai:gpt-4.1", False),
    ]

    metrics = pass_metrics_for_group(runs)

    assert metrics["k"] == 3
    assert metrics["pass_at_1"] == 2 / 3
    assert metrics["pass_at_k"] == 1.0
    assert metrics["pass_hat_k"] == 0.0


def test_pass_metrics_all_passed():
    runs = [run("m", True), run("m", True), run("m", True)]

    metrics = pass_metrics_for_group(runs)

    assert metrics["pass_at_1"] == 1.0
    assert metrics["pass_at_k"] == 1.0
    assert metrics["pass_hat_k"] == 1.0


def test_pass_metrics_all_failed():
    runs = [run("m", False), run("m", False)]

    metrics = pass_metrics_for_group(runs)

    assert metrics["pass_at_1"] == 0.0
    assert metrics["pass_at_k"] == 0.0
    assert metrics["pass_hat_k"] == 0.0


def test_pass_metrics_k_equals_one():
    assert pass_metrics_for_group([run("m", True)]) == {
        "k": 1,
        "pass_at_1": 1.0,
        "pass_at_k": 1.0,
        "pass_hat_k": 1.0,
    }
    assert pass_metrics_for_group([run("m", False)]) == {
        "k": 1,
        "pass_at_1": 0.0,
        "pass_at_k": 0.0,
        "pass_hat_k": 0.0,
    }


def test_suite_aggregation_weights_by_test_case_not_attempts():
    # One test with k=5 (all pass) and one with k=1 (fail) must average 0.5 each metric,
    # not weight the k=5 case five times.
    runs = [
        run("m", True, name="a"),
        run("m", True, name="a"),
        run("m", True, name="a"),
        run("m", True, name="a"),
        run("m", True, name="a"),
        run("m", False, name="b"),
    ]

    summary = summarize_pass_metrics(runs)

    assert summary["k"] == 5
    assert summary["aggregate"]["pass_at_1"] == 0.5
    assert summary["aggregate"]["pass_at_k"] == 0.5
    assert summary["aggregate"]["pass_hat_k"] == 0.5
    assert len(summary["by_test"]) == 2


def test_summarize_pass_metrics_output_shape():
    runs = [
        run("openai:gpt-4.1", True, name="orders", attempt=1),
        run("openai:gpt-4.1", False, name="orders", attempt=2),
        run("anthropic:claude", True, name="users", attempt=1),
    ]

    summary = summarize_pass_metrics(runs)

    assert set(summary.keys()) == {"k", "aggregate", "by_test"}
    assert set(summary["aggregate"].keys()) == {"pass_at_1", "pass_at_k", "pass_hat_k"}
    assert summary["k"] == 2
    for item in summary["by_test"]:
        assert set(item.keys()) == {"name", "model", "k", "pass_at_1", "pass_at_k", "pass_hat_k"}


def test_group_by_test_and_model():
    runs = [
        run("m1", True, name="a"),
        run("m1", False, name="a"),
        run("m2", True, name="a"),
        run("m1", True, name="b"),
    ]

    groups = group_by_test_and_model(runs)

    assert set(groups.keys()) == {("a", "m1"), ("a", "m2"), ("b", "m1")}
    assert len(groups[("a", "m1")]) == 2


def test_summarize_by_model_includes_pass_metrics_averaged_across_tests():
    runs = [
        run("m1", True, name="a"),
        run("m1", False, name="a"),  # pass@1=0.5, pass@k=1, pass^k=0
        run("m1", True, name="b"),  # pass@1=1, pass@k=1, pass^k=1
        run("m2", False, name="a"),
    ]

    by_model = {s.model: s for s in summarize_by_model(runs)}

    assert by_model["m1"].pass_at_1 == 0.75
    assert by_model["m1"].pass_at_k == 1.0
    assert by_model["m1"].pass_hat_k == 0.5
    assert by_model["m1"].k == 2
    assert by_model["m2"].pass_at_1 == 0.0


def test_with_model_summaries_handles_old_results_without_k_or_pass_metrics():
    data = {
        "results": [
            run("openai:gpt-4.1", True, name="orders"),
            run("openai:gpt-4.1", False, name="users"),
        ],
        "summary": {"total": 2, "passed": 1, "failed": 1},
    }

    backfilled = with_model_summaries(data)

    assert "pass_metrics" not in data  # input unchanged shape is fine
    assert backfilled["by_model"][0]["pass_rate"] == 50.0
    assert backfilled["by_model"][0]["k"] == 1
