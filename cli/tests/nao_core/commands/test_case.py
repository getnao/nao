import pytest

from nao_core.commands.test.assertions import AssertionConfigError, ToolCallAssertion
from nao_core.commands.test.case import TestCase, discover_tests


def test_discover_tests_is_recursive(tmp_path):
    (tmp_path / "tests" / "revenue").mkdir(parents=True)
    (tmp_path / "tests" / "revenue" / "mrr.yml").write_text("prompt: how much mrr\n")
    (tmp_path / "tests" / "ops" / "sla").mkdir(parents=True)
    (tmp_path / "tests" / "ops" / "sla" / "uptime.yaml").write_text("prompt: uptime\n")

    cases = discover_tests(tmp_path)

    names = {c.name for c in cases}
    assert names == {"mrr", "uptime"}


def test_discover_tests_ignores_outputs_dir(tmp_path):
    (tmp_path / "tests").mkdir()
    (tmp_path / "tests" / "real.yml").write_text("prompt: real\n")
    (tmp_path / "tests" / "outputs").mkdir()
    (tmp_path / "tests" / "outputs" / "results.yml").write_text("prompt: not a test\n")

    cases = discover_tests(tmp_path)

    assert {c.name for c in cases} == {"real"}


def test_from_yaml_loads_tool_call_assertions(tmp_path):
    path = tmp_path / "ambiguous_revenue.yml"
    path.write_text(
        "\n".join(
            [
                "name: ambiguous_revenue_period",
                "prompt: What was the revenue?",
                "assertions:",
                "  - type: tool_call",
                "    tool: clarification",
                "",
            ]
        )
    )

    case = TestCase.from_yaml(path)

    assert case.name == "ambiguous_revenue_period"
    assert case.prompt == "What was the revenue?"
    assert case.sql is None
    assert case.assertions == [ToolCallAssertion(tool="clarification")]


def test_from_yaml_rejects_invalid_assertions(tmp_path):
    path = tmp_path / "bad.yml"
    path.write_text("prompt: hi\nassertions:\n  - type: nope\n")

    with pytest.raises(AssertionConfigError, match="unknown type"):
        TestCase.from_yaml(path)


def test_evaluate_tool_call_assertion_reports_matched_count_when_min_count_exceeds():
    from nao_core.commands.test.assertions import evaluate_tool_call_assertion

    assertion = ToolCallAssertion(tool="fetch", args={"type": "user"}, min_count=2)
    tool_calls = [
        {"toolName": "fetch", "args": {"type": "user"}},
        {"toolName": "fetch", "args": {"type": "other"}},
    ]
    passed, msg = evaluate_tool_call_assertion(assertion, tool_calls)

    assert passed is False
    assert "(found 1 matching, need >= 2; 2 total)" in msg
