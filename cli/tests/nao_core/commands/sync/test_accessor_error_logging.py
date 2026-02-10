"""Test that accessor errors are logged to CLI."""

from unittest.mock import MagicMock, patch

from nao_core.commands.sync.accessors import ColumnsAccessor


def test_accessor_error_logging_to_console():
    """Test that accessor errors are printed to console."""
    accessor = ColumnsAccessor()

    # Mock connection to fail during get_context
    mock_conn = MagicMock()
    mock_conn.table.side_effect = RuntimeError("Test database error!")

    # Capture console output
    with patch("nao_core.commands.sync.accessors.console") as mock_console:
        result = accessor.generate(conn=mock_conn, dataset="test_schema", table="test_table")

    # Verify error was printed to console
    mock_console.print.assert_called_once()
    call_args = mock_console.print.call_args[0][0]

    # Check the error message contains all expected parts
    assert "Error generating columns.md" in call_args
    assert "test_schema.test_table" in call_args
    assert "Test database error!" in call_args
    assert "[red]✗[/red]" in call_args

    # Verify result still has error message
    assert "Error generating content" in result


def test_accessor_returns_error_markdown():
    """Test that accessor returns markdown with error message."""
    accessor = ColumnsAccessor()

    mock_conn = MagicMock()
    mock_conn.table.side_effect = ValueError("Column not found")

    with patch("nao_core.commands.sync.accessors.console"):
        result = accessor.generate(conn=mock_conn, dataset="db", table="users")

    # Should return markdown with table name and error
    assert "# users" in result
    assert "Error generating content" in result
    assert "Column not found" in result
