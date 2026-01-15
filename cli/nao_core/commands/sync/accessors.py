"""Data accessor classes for generating markdown documentation from database tables."""

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
        full_table_name = f"{dataset}.{table}"
        return conn.table(full_table_name)


class ColumnsAccessor(DataAccessor):
    """Generates columns.md with column names, types, and nullable info."""

    @property
    def filename(self) -> str:
        return "columns.md"

    def generate(self, conn: BaseBackend, dataset: str, table: str) -> str:
        try:
            t = self.get_table(conn, dataset, table)
            schema = t.schema()

            lines = [
                f"# {table}",
                "",
                f"**Dataset:** `{dataset}`",
                "",
                "## Columns",
                "",
                "| Column | Type | Nullable | Description |",
                "|--------|------|----------|-------------|",
            ]

            for name, dtype in schema.items():
                nullable = "Yes" if dtype.nullable else "No"
                description = ""
                lines.append(f"| `{name}` | `{dtype}` | {nullable} | {description} |")

            return "\n".join(lines)
        except Exception as e:
            return f"# {table}\n\nError fetching schema: {e}"


class PreviewAccessor(DataAccessor):
    """Generates preview.md with the first N rows of data."""

    def __init__(self, num_rows: int = 10):
        self.num_rows = num_rows

    @property
    def filename(self) -> str:
        return "preview.md"

    def generate(self, conn: BaseBackend, dataset: str, table: str) -> str:
        try:
            t = self.get_table(conn, dataset, table)
            schema = t.schema()

            preview_df = t.limit(self.num_rows).execute()

            lines = [
                f"# {table} - Preview",
                "",
                f"**Dataset:** `{dataset}`",
                f"**Showing:** First {len(preview_df)} rows",
                "",
                "## Data Preview",
                "",
            ]

            columns = list(schema.keys())
            header = "| " + " | ".join(f"`{col}`" for col in columns) + " |"
            separator = "| " + " | ".join("---" for _ in columns) + " |"
            lines.append(header)
            lines.append(separator)

            for _, row in preview_df.iterrows():
                row_values = []
                for col in columns:
                    val = row[col]
                    val_str = str(val) if val is not None else ""
                    if len(val_str) > 50:
                        val_str = val_str[:47] + "..."
                    val_str = val_str.replace("|", "\\|").replace("\n", " ")
                    row_values.append(val_str)
                lines.append("| " + " | ".join(row_values) + " |")

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
