"""Base database context exposing methods available in templates during sync."""

from typing import Any

from ibis import BaseBackend


class DatabaseContext:
    """Context object passed to Jinja2 templates during database sync.

    Exposes data-fetching methods that templates can call to retrieve
    column metadata, row previews, table descriptions, etc.

    Subclasses override description(), columns(), and partition_columns()
    to fetch warehouse-specific metadata (e.g. BigQuery partition info).
    """

    def __init__(self, conn: BaseBackend, schema: str, table_name: str):
        self._conn = conn
        self._schema = schema
        self._table_name = table_name
        self._table_ref = None

    @property
    def table(self):
        if self._table_ref is None:
            self._table_ref = self._conn.table(self._table_name, database=self._schema)
        return self._table_ref

    def columns(self) -> list[dict[str, Any]]:
        """Return column metadata: name, type, nullable, description."""
        schema = self.table.schema()
        return [
            {
                "name": name,
                "type": self._format_type(dtype),
                "nullable": dtype.nullable if hasattr(dtype, "nullable") else True,
                "description": None,
            }
            for name, dtype in schema.items()
        ]

    @staticmethod
    def _format_type(dtype) -> str:
        """Convert Ibis type to a human-readable string (e.g. !int32 -> int32 NOT NULL)."""
        raw = str(dtype)
        if raw.startswith("!"):
            return f"{raw[1:]} NOT NULL"
        return raw

    def preview(self, limit: int = 10) -> list[dict[str, Any]]:
        """Return the first N rows as a list of dictionaries."""
        df = self.table.limit(limit).execute()
        rows = []
        for _, row in df.iterrows():
            row_dict = row.to_dict()
            for key, val in row_dict.items():
                if val is not None and not isinstance(val, (str, int, float, bool, list, dict)):
                    row_dict[key] = str(val)
            rows.append(row_dict)
        return rows

    def row_count(self) -> int:
        """Return the total number of rows in the table."""
        return self.table.count().execute()

    def column_count(self) -> int:
        """Return the number of columns in the table."""
        return len(self.table.schema())

    def partition_columns(self) -> list[str]:
        """Return partition/clustering column names if available."""
        return []

    def description(self) -> str | None:
        """Return the table description if available."""
        return None
