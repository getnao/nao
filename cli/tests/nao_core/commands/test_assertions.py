import pytest

from nao_core.commands.test.assertions import (
    AssertionConfigError,
    ToolCallAssertion,
    combine_check_messages,
    evaluate_assertions,
    evaluate_tool_call_assertion,
    parse_assertions,
)


def test_parse_assertions_empty():
    assert parse_assertions(None) == []
    assert parse_assertions([]) == []


def test_parse_tool_call_assertion():
    assertions = parse_assertions([{"type": "tool_call", "tool": "clarification"}])

    assert assertions == [ToolCallAssertion(tool="clarification")]


def test_parse_tool_call_with_args_and_min_count():
    assertions = parse_assertions(
        [
            {
                "type": "tool_call",
                "tool": "execute_sql",
                "args": {"sql_query": "SELECT 1"},
                "min_count": 2,
            }
        ]
    )

    assert assertions == [ToolCallAssertion(tool="execute_sql", args={"sql_query": "SELECT 1"}, min_count=2)]


def test_parse_rejects_unknown_type():
    with pytest.raises(AssertionConfigError, match="unknown type 'text'"):
        parse_assertions([{"type": "text", "pattern": "hello"}])


def test_parse_rejects_missing_tool():
    with pytest.raises(AssertionConfigError, match="non-empty 'tool'"):
        parse_assertions([{"type": "tool_call"}])


def test_evaluate_tool_call_passes_when_present():
    passed, msg = evaluate_tool_call_assertion(
        ToolCallAssertion(tool="clarification"),
        [{"toolName": "clarification", "args": {"question": "Which period?"}}],
    )

    assert passed is True
    assert msg == "tool_call: clarification"


def test_evaluate_tool_call_fails_when_missing():
    # Models the issue case: agent answered numerically via SQL instead of asking.
    passed, msg = evaluate_tool_call_assertion(
        ToolCallAssertion(tool="clarification"),
        [{"toolName": "execute_sql", "args": {"sql_query": "SELECT SUM(amount) FROM orders"}}],
    )

    assert passed is False
    assert msg == "missing tool_call: clarification"


def test_evaluate_tool_call_fails_on_empty_trace():
    passed, msg = evaluate_tool_call_assertion(ToolCallAssertion(tool="clarification"), [])

    assert passed is False
    assert msg == "missing tool_call: clarification"


def test_evaluate_tool_call_args_subset_match():
    assertion = ToolCallAssertion(tool="execute_sql", args={"sql_query": "SELECT 1"})
    passed, msg = evaluate_tool_call_assertion(
        assertion,
        [
            {
                "toolName": "execute_sql",
                "args": {"sql_query": "SELECT 1", "limit": 100},
            }
        ],
    )

    assert passed is True
    assert "args matched" in msg


def test_evaluate_tool_call_args_mismatch():
    assertion = ToolCallAssertion(tool="execute_sql", args={"sql_query": "SELECT 1"})
    passed, msg = evaluate_tool_call_assertion(
        assertion,
        [{"toolName": "execute_sql", "args": {"sql_query": "SELECT 2"}}],
    )

    assert passed is False
    assert "without matching args" in msg


def test_evaluate_tool_call_min_count():
    assertion = ToolCallAssertion(tool="read", min_count=2)
    one_call = [{"toolName": "read", "args": {"path": "a"}}]
    two_calls = one_call + [{"toolName": "read", "args": {"path": "b"}}]

    assert evaluate_tool_call_assertion(assertion, one_call)[0] is False
    assert evaluate_tool_call_assertion(assertion, two_calls)[0] is True


def test_evaluate_assertions_combines_messages():
    assertions = [
        ToolCallAssertion(tool="clarification"),
        ToolCallAssertion(tool="execute_sql"),
    ]
    passed, msg = evaluate_assertions(
        assertions,
        [{"toolName": "clarification", "args": {"question": "?"}}],
    )

    assert passed is False
    assert msg == "tool_call: clarification; missing tool_call: execute_sql"


def test_combine_check_messages_skips_empty():
    assert combine_check_messages("tool_call: clarification", "match") == "tool_call: clarification; match"
    assert combine_check_messages("", "match") == "match"
    assert combine_check_messages("tool_call: clarification", "") == "tool_call: clarification"
