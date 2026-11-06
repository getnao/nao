import pytest

from nao_core.commands.test.assertions import ToolCallAssertion, evaluate_tool_call_assertion


@pytest.mark.parametrize(
    ("expected_tool", "called_tool"),
    [
        ("page_query_result", "page_query_result"),
        ("page_query_result", "read_query_result"),
        ("read_query_result", "page_query_result"),
    ],
)
def test_tool_call_matches_a_renamed_tool_under_either_name(expected_tool, called_tool):
    assertion = ToolCallAssertion(tool=expected_tool, args={"query_id": "query_a1b2c3d4"})
    calls = [{"toolName": called_tool, "args": {"query_id": "query_a1b2c3d4", "offset": 40}}]

    passed, _ = evaluate_tool_call_assertion(assertion, calls)

    assert passed


def test_tool_call_does_not_match_a_different_tool():
    assertion = ToolCallAssertion(tool="page_query_result")
    calls = [{"toolName": "read", "args": {"file_path": "/RULES.md"}}]

    passed, message = evaluate_tool_call_assertion(assertion, calls)

    assert not passed
    assert message == "missing tool_call: page_query_result"
