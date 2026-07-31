from nao_core.commands.test.summary import summarize, summarize_by_model, with_model_summaries


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
