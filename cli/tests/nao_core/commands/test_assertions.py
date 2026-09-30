import pytest

from nao_core.commands.test.assertions import (
    AssertionConfigError,
    ToolCallAssertion,
    evaluate_assertions,
    evaluate_tool_call_assertion,
    parse_assertions,
)


def test_parse_assertions_returns_empty_list_when_absent():
    assert parse_assertions(None) == []


def test_parse_assertions_builds_tool_call_assertions():
    assertions = parse_assertions(
        [
            {"type": "tool_call", "tool": "clarification"},
            {"type": "tool_call", "tool": "execute_sql", "args": {"sql_query": "SELECT 1"}, "min_count": 2},
        ]
    )

    assert assertions == [
        ToolCallAssertion(tool="clarification"),
        ToolCallAssertion(tool="execute_sql", args={"sql_query": "SELECT 1"}, min_count=2),
    ]


@pytest.mark.parametrize(
    ("raw", "message"),
    [
        ("tool_call", "'assertions' must be a list"),
        (["tool_call"], "assertions\\[0\\] must be a mapping"),
        ([{"tool": "clarification"}], "assertions\\[0\\] is missing 'type'"),
        ([{"type": "step_count", "tool": "x"}], "unknown type 'step_count'"),
        ([{"type": "tool_call"}], "requires a non-empty 'tool' string"),
        ([{"type": "tool_call", "tool": "   "}], "requires a non-empty 'tool' string"),
        ([{"type": "tool_call", "tool": "execute_sql", "args": "SELECT 1"}], "'args' must be a mapping"),
        ([{"type": "tool_call", "tool": "execute_sql", "args": {}}], "'args' must not be empty"),
        ([{"type": "tool_call", "tool": "execute_sql", "min_count": 0}], "'min_count' must be an integer >= 1"),
        ([{"type": "tool_call", "tool": "execute_sql", "min_count": True}], "'min_count' must be an integer >= 1"),
        ([{"type": "tool_call", "tool": "execute_sql", "min_count": "2"}], "'min_count' must be an integer >= 1"),
        ([{"type": "tool_call", "tol": "clarification"}], "requires a non-empty 'tool' string"),
        (
            [{"type": "tool_call", "tool": "clarification", "extra": 1}],
            "unknown tool_call assertion fields: \\['extra'\\]",
        ),
    ],
)
def test_parse_assertions_rejects_invalid_definitions(raw, message):
    with pytest.raises(AssertionConfigError, match=message):
        parse_assertions(raw)


def test_tool_call_assertion_strips_tool_name():
    assertion = ToolCallAssertion.from_dict({"type": "tool_call", "tool": " clarification "})

    assert assertion.tool == "clarification"


def test_tool_call_passes_when_tool_was_called():
    passed, message = evaluate_tool_call_assertion(
        ToolCallAssertion(tool="clarification"),
        [{"toolName": "clarification", "args": {"question": "Which period?"}}],
    )

    assert passed is True
    assert message == "tool_call: clarification"


def test_tool_call_fails_when_tool_was_not_called():
    passed, message = evaluate_tool_call_assertion(
        ToolCallAssertion(tool="clarification"),
        [{"toolName": "execute_sql", "args": {"sql_query": "SELECT 1"}}],
    )

    assert passed is False
    assert message == "missing tool_call: clarification"


def test_tool_call_handles_missing_tool_call_trace():
    passed, message = evaluate_tool_call_assertion(ToolCallAssertion(tool="clarification"), None)

    assert passed is False
    assert message == "missing tool_call: clarification"


def test_tool_call_args_match_as_a_subset():
    assertion = ToolCallAssertion(tool="execute_sql", args={"database_id": "warehouse"})

    passed, message = evaluate_tool_call_assertion(
        assertion,
        [{"toolName": "execute_sql", "args": {"sql_query": "SELECT 1", "database_id": "warehouse"}}],
    )

    assert passed is True
    assert message == "tool_call: execute_sql (x1, args matched)"


def test_tool_call_args_match_nested_mappings_recursively():
    assertion = ToolCallAssertion(tool="display_chart", args={"options": {"kind": "bar"}})

    passed, _ = evaluate_tool_call_assertion(
        assertion,
        [{"toolName": "display_chart", "args": {"options": {"kind": "bar", "stacked": True}, "title": "Sales"}}],
    )

    assert passed is True


def test_tool_call_args_require_list_equality():
    assertion = ToolCallAssertion(tool="display_chart", args={"columns": ["a", "b"]})

    passed, _ = evaluate_tool_call_assertion(
        assertion,
        [{"toolName": "display_chart", "args": {"columns": ["a", "b", "c"]}}],
    )

    assert passed is False


def test_tool_call_args_fail_when_value_differs():
    assertion = ToolCallAssertion(tool="execute_sql", args={"database_id": "warehouse"})

    passed, message = evaluate_tool_call_assertion(
        assertion,
        [{"toolName": "execute_sql", "args": {"database_id": "lake"}}],
    )

    assert passed is False
    assert message == (
        "missing tool_call: execute_sql with args {'database_id': 'warehouse'} (found 0 matching, need >= 1; 1 total)"
    )


def test_tool_call_args_fail_when_tool_was_never_called():
    assertion = ToolCallAssertion(tool="execute_sql", args={"database_id": "warehouse"})

    passed, message = evaluate_tool_call_assertion(assertion, [])

    assert passed is False
    assert message == "missing tool_call: execute_sql with args {'database_id': 'warehouse'}"


def test_tool_call_args_fail_when_actual_value_is_not_a_mapping():
    assertion = ToolCallAssertion(tool="display_chart", args={"options": {"kind": "bar"}})

    passed, _ = evaluate_tool_call_assertion(
        assertion,
        [{"toolName": "display_chart", "args": {"options": "bar"}}],
    )

    assert passed is False


@pytest.mark.parametrize(
    ("expected", "actual"),
    [
        (True, 1),
        (False, 0),
        (1, True),
        (0, False),
        (True, 1.0),
    ],
)
def test_tool_call_args_do_not_confuse_booleans_with_numbers(expected, actual):
    assertion = ToolCallAssertion(tool="display_chart", args={"stacked": expected})

    passed, _ = evaluate_tool_call_assertion(
        assertion,
        [{"toolName": "display_chart", "args": {"stacked": actual}}],
    )

    assert passed is False


def test_tool_call_args_match_equal_booleans():
    assertion = ToolCallAssertion(tool="display_chart", args={"stacked": True})

    passed, _ = evaluate_tool_call_assertion(
        assertion,
        [{"toolName": "display_chart", "args": {"stacked": True}}],
    )

    assert passed is True


def test_tool_call_min_count_passes_when_reached():
    assertion = ToolCallAssertion(tool="execute_sql", min_count=2)

    passed, message = evaluate_tool_call_assertion(
        assertion,
        [
            {"toolName": "execute_sql", "args": {"sql_query": "SELECT 1"}},
            {"toolName": "read_query_result", "args": {}},
            {"toolName": "execute_sql", "args": {"sql_query": "SELECT 2"}},
        ],
    )

    assert passed is True
    assert message == "tool_call: execute_sql (x2, min 2)"


def test_tool_call_min_count_fails_when_not_reached():
    assertion = ToolCallAssertion(tool="execute_sql", min_count=2)

    passed, message = evaluate_tool_call_assertion(
        assertion,
        [{"toolName": "execute_sql", "args": {"sql_query": "SELECT 1"}}],
    )

    assert passed is False
    assert message == "missing tool_call: execute_sql (found 1, need >= 2)"


def test_tool_call_min_count_only_counts_calls_whose_args_match():
    assertion = ToolCallAssertion(tool="execute_sql", args={"database_id": "warehouse"}, min_count=2)

    passed, message = evaluate_tool_call_assertion(
        assertion,
        [
            {"toolName": "execute_sql", "args": {"database_id": "warehouse"}},
            {"toolName": "execute_sql", "args": {"database_id": "lake"}},
        ],
    )

    assert passed is False
    assert message == (
        "missing tool_call: execute_sql with args {'database_id': 'warehouse'} (found 1 matching, need >= 2; 2 total)"
    )


def test_evaluate_assertions_passes_with_no_assertions():
    assert evaluate_assertions([], None) == (True, "")


def test_evaluate_assertions_combines_messages_and_fails_if_any_fails():
    assertions = [ToolCallAssertion(tool="execute_sql"), ToolCallAssertion(tool="clarification")]

    passed, message = evaluate_assertions(assertions, [{"toolName": "execute_sql", "args": {}}])

    assert passed is False
    assert message == "tool_call: execute_sql; missing tool_call: clarification"
