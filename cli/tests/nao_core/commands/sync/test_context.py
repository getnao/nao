"""Unit tests for DatabaseContext."""

from unittest.mock import MagicMock

import pandas as pd

from nao_core.commands.sync.providers.databases.context import DatabaseContext


class TestDatabaseContext:
    def _make_context(self):
        mock_conn = MagicMock()
        mock_table = MagicMock()
        mock_schema = MagicMock()
        schema_items = [
            ("id", MagicMock(__str__=lambda s: "int64", nullable=False)),
            ("name", MagicMock(__str__=lambda s: "string", nullable=True)),
        ]
        mock_schema.items.return_value = schema_items
        mock_schema.__len__ = lambda s: len(schema_items)
        mock_table.schema.return_value = mock_schema
        mock_conn.table.return_value = mock_table
        return DatabaseContext(mock_conn, "my_schema", "my_table"), mock_table

    def test_columns_returns_metadata(self):
        ctx, _ = self._make_context()
        columns = ctx.columns()

        assert len(columns) == 2
        assert columns[0]["name"] == "id"
        assert columns[0]["type"] == "int64"
        assert columns[1]["name"] == "name"
        assert columns[1]["type"] == "string"

    def test_preview_returns_rows(self):
        ctx, mock_table = self._make_context()
        df = pd.DataFrame({"id": [1, 2], "name": ["Alice", "Bob"]})
        mock_table.limit.return_value.execute.return_value = df

        rows = ctx.preview(limit=2)

        assert len(rows) == 2
        assert rows[0]["name"] == "Alice"
        mock_table.limit.assert_called_once_with(2)

    def test_row_count(self):
        ctx, mock_table = self._make_context()
        mock_table.count.return_value.execute.return_value = 42

        assert ctx.row_count() == 42

    def test_column_count(self):
        ctx, _ = self._make_context()
        assert ctx.column_count() == 2

    def test_description_returns_none_by_default(self):
        ctx, _ = self._make_context()
        assert ctx.description() is None

    def test_table_is_lazily_loaded(self):
        mock_conn = MagicMock()
        ctx = DatabaseContext(mock_conn, "schema", "table")

        mock_conn.table.assert_not_called()
        _ = ctx.table
        mock_conn.table.assert_called_once_with("table", database="schema")

    def test_table_is_cached(self):
        mock_conn = MagicMock()
        ctx = DatabaseContext(mock_conn, "schema", "table")

        _ = ctx.table
        _ = ctx.table
        mock_conn.table.assert_called_once()
