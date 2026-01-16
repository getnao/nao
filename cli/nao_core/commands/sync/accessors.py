"""Data accessor classes for generating markdown documentation from database tables."""

import json
from abc import ABC, abstractmethod

from ibis import BaseBackend


class DataAccessor(ABC):
    """Base class for data accessors that generate markdown files for tables."""

    @property
    @abstractmethod
    def filename(self) -> str:
        """The filename this accessor writes to (e.g., 'columns.md')."""
        ...

    @abstractmethod
    def generate(self, conn: BaseBackend, dataset: str, table: str) -> str:
        """Generate the markdown content for a table.

        Args:
                conn: The Ibis database connection
                dataset: The dataset/schema name
                table: The table name

        Returns:
                Markdown string content
        """
        ...

    def get_table(self, conn: BaseBackend, dataset: str, table: str):
        """Helper to get an Ibis table reference."""
        return conn.table(table, database=dataset)


def truncate_middle(text: str, max_length: int) -> str:
    """Truncate text in the middle if it exceeds max_length."""
    if len(text) <= max_length:
        return text
    half = (max_length - 3) // 2
    return text[:half] + "..." + text[-half:]


class ColumnsAccessor(DataAccessor):
    """Generates columns.md with column names, types, and nullable info."""

    def __init__(self, max_description_length: int = 256):
        self.max_description_length = max_description_length

    @property
    def filename(self) -> str:
        return "columns.md"

    def generate(self, conn: BaseBackend, dataset: str, table: str) -> str:
        try:
            t = self.get_table(conn, dataset, table)
            schema = t.schema()
            columns = list(schema.items())

            lines = [
                f"# {table}",
                "",
                f"**Dataset:** `{dataset}`",
                "",
                f"## Columns ({len(columns)})",
                "",
            ]

            for name, dtype in columns:
                description = None
                parts = [str(dtype)]
                if description:
                    truncated = truncate_middle(description, self.max_description_length)
                    parts.append(f'"{truncated}"')
                lines.append(f"- {name} ({', '.join(parts)})")

            return "\n".join(lines)
        except Exception as e:
            print(e)
            return f"# {table}\n\nError fetching schema: {e}"


class PreviewAccessor(DataAccessor):
    """Generates preview.md with the first N rows of data as JSONL."""

    def __init__(self, num_rows: int = 10):
        self.num_rows = num_rows

    @property
    def filename(self) -> str:
        return "preview.md"

    def generate(self, conn: BaseBackend, dataset: str, table: str) -> str:
        try:
            t = self.get_table(conn, dataset, table)
            preview_df = t.limit(self.num_rows).execute()

            lines = [
                f"# {table} - Preview",
                "",
                f"**Dataset:** `{dataset}`",
                "",
                f"## Rows ({len(preview_df)})",
                "",
            ]

            for _, row in preview_df.iterrows():
                row_dict = row.to_dict()
                # Convert non-serializable types to strings
                for key, val in row_dict.items():
                    if val is not None and not isinstance(val, (str, int, float, bool, list, dict)):
                        row_dict[key] = str(val)
                lines.append(f"- {json.dumps(row_dict)}")

            return "\n".join(lines)
        except Exception as e:
            return f"# {table} - Preview\n\nError fetching preview: {e}"


class DescriptionAccessor(DataAccessor):
    """Generates description.md with table metadata (row count, column count, etc.)."""

    @property
    def filename(self) -> str:
        return "description.md"

    def generate(self, conn: BaseBackend, dataset: str, table: str) -> str:
        try:
            t = self.get_table(conn, dataset, table)
            schema = t.schema()

            row_count = t.count().execute()
            col_count = len(schema)

            lines = [
                f"# {table}",
                "",
                f"**Dataset:** `{dataset}`",
                "",
                "## Table Metadata",
                "",
                "| Property | Value |",
                "|----------|-------|",
                f"| **Row Count** | {row_count:,} |",
                f"| **Column Count** | {col_count} |",
                "",
                "## Description",
                "",
                "_No description available._",
                "",
            ]

            return "\n".join(lines)
        except Exception as e:
            return f"# {table}\n\nError fetching description: {e}"


class ProfilingAccessor(DataAccessor):
    """Generates profiling.md with column statistics and data profiling."""

    @property
    def filename(self) -> str:
        return "profiling.md"

    def generate(self, conn: BaseBackend, dataset: str, table: str) -> str:
        try:
            t = self.get_table(conn, dataset, table)
            schema = t.schema()

            lines = [
                f"# {table} - Profiling",
                "",
                f"**Dataset:** `{dataset}`",
                "",
                "## Column Statistics",
                "",
                "| Column | Type | Nulls | Unique | Min | Max |",
                "|--------|------|-------|--------|-----|-----|",
            ]

            for name, dtype in schema.items():
                col = t[name]
                dtype_str = str(dtype)

                try:
                    null_count = t.filter(col.isnull()).count().execute()
                    unique_count = col.nunique().execute()

                    min_val = ""
                    max_val = ""
                    if dtype.is_numeric() or dtype.is_temporal():
                        try:
                            min_val = str(col.min().execute())
                            max_val = str(col.max().execute())
                            if len(min_val) > 20:
                                min_val = min_val[:17] + "..."
                            if len(max_val) > 20:
                                max_val = max_val[:17] + "..."
                        except Exception:
                            pass

                    lines.append(
                        f"| `{name}` | `{dtype_str}` | {null_count:,} | {unique_count:,} | {min_val} | {max_val} |"
                    )
                except Exception as col_error:
                    lines.append(f"| `{name}` | `{dtype_str}` | Error: {col_error} | | | |")

            return "\n".join(lines)
        except Exception as e:
            return f"# {table} - Profiling\n\nError fetching profiling: {e}"
