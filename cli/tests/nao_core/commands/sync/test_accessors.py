"""Unit tests for sync accessors."""

from unittest.mock import MagicMock

from nao_core.commands.sync.accessors import (
    ColumnsAccessor,
    DescriptionAccessor,
    PreviewAccessor,
    ProfilingAccessor,
    truncate_middle,
)


class TestTruncateMiddle:
    def test_short_text_unchanged(self):
        assert truncate_middle("hello", 10) == "hello"

    def test_exact_length_unchanged(self):
        assert truncate_middle("hello", 5) == "hello"

    def test_long_text_truncated(self):
        result = truncate_middle("hello world example", 10)
        assert len(result) <= 10
        assert "..." in result

    def test_truncation_preserves_start_and_end(self):
        result = truncate_middle("abcdefghijklmnop", 10)
        assert result.startswith("abc")
        assert result.endswith("nop")


class TestColumnsAccessor:
    def test_filename(self):
        accessor = ColumnsAccessor()
        assert accessor.filename == "columns.md"

    def test_generate_creates_markdown(self):
        accessor = ColumnsAccessor()
        mock_conn = MagicMock()
        mock_table = MagicMock()
        mock_schema = MagicMock()
        mock_schema.items.return_value = [
            ("id", "int64"),
            ("name", "string"),
        ]
        mock_table.schema.return_value = mock_schema
        mock_conn.table.return_value = mock_table

        result = accessor.generate(mock_conn, "my_dataset", "my_table")

        assert "# my_table" in result
        assert "**Dataset:** `my_dataset`" in result
        assert "## Columns (2)" in result
        assert "- id (int64)" in result
        assert "- name (string)" in result

    def test_generate_handles_error(self):
        accessor = ColumnsAccessor()
        mock_conn = MagicMock()
        mock_conn.table.side_effect = Exception("Connection error")

        result = accessor.generate(mock_conn, "my_dataset", "my_table")

        assert "# my_table" in result
        assert "Error generating content" in result or "Connection error" in result


class TestPreviewAccessor:
    def test_filename(self):
        accessor = PreviewAccessor()
        assert accessor.filename == "preview.md"

    def test_custom_num_rows(self):
        accessor = PreviewAccessor(num_rows=5)
        assert accessor.num_rows == 5


class TestDescriptionAccessor:
    def test_filename(self):
        accessor = DescriptionAccessor()
        assert accessor.filename == "description.md"


class TestProfilingAccessor:
    def test_filename(self):
        accessor = ProfilingAccessor()
        assert accessor.filename == "profiling.md"
