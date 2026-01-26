"""Data accessor classes for generating markdown documentation from database tables."""

from abc import ABC, abstractmethod
from pathlib import Path
from typing import Any

from ibis import BaseBackend

from nao_core.templates import get_template_engine


class DataAccessor(ABC):
    """Base class for data accessors that generate markdown files for tables.

    Accessors use Jinja2 templates for generating output. Default templates
    are shipped with nao and can be overridden by users by placing templates
    with the same name in their project's `templates/` directory.

    Example:
        To override the preview template, create:
        `<project_root>/templates/databases/preview.md.j2`
    """

    # Path to the nao project root (set by sync provider)
    _project_path: Path | None = None

    @property
    @abstractmethod
    def filename(self) -> str:
        """The filename this accessor writes to (e.g., 'columns.md')."""
        ...

    @property
    @abstractmethod
    def template_name(self) -> str:
        """The template file to use (e.g., 'databases/columns.md.j2')."""
        ...

    @abstractmethod
    def get_context(self, conn: BaseBackend, dataset: str, table: str) -> dict[str, Any]:
        """Get the template context for rendering.

        Args:
            conn: The Ibis database connection
            dataset: The dataset/schema name
            table: The table name

        Returns:
            Dictionary of variables to pass to the template
        """
        ...

    def generate(self, conn: BaseBackend, dataset: str, table: str) -> str:
        """Generate the markdown content for a table using templates.

        Args:
            conn: The Ibis database connection
            dataset: The dataset/schema name
            table: The table name

        Returns:
            Markdown string content
        """
        try:
            context = self.get_context(conn, dataset, table)
            engine = get_template_engine(self._project_path)
            return engine.render(self.template_name, **context)
        except Exception as e:
            return f"# {table}\n\nError generating content: {e}"

    def get_table(self, conn: BaseBackend, dataset: str, table: str):
        """Helper to get an Ibis table reference."""
        return conn.table(table, database=dataset)

    @classmethod
    def set_project_path(cls, path: Path | None) -> None:
        """Set the project path for template resolution.

        Args:
            path: Path to the nao project root
        """
        cls._project_path = path


def truncate_middle(text: str, max_length: int) -> str:
    """Truncate text in the middle if it exceeds max_length."""
    if len(text) <= max_length:
        return text
    half = (max_length - 3) // 2
    return text[:half] + "..." + text[-half:]


class ColumnsAccessor(DataAccessor):
    """Generates columns.md with column names, types, and nullable info.

    Template variables:
        - table_name: Name of the table
        - dataset: Schema/dataset name
        - columns: List of dicts with 'name', 'type', 'nullable', 'description'
        - column_count: Total number of columns
    """

    def __init__(self, max_description_length: int = 256):
        self.max_description_length = max_description_length

    @property
    def filename(self) -> str:
        return "columns.md"

    @property
    def template_name(self) -> str:
        return "databases/columns.md.j2"

    def get_context(self, conn: BaseBackend, dataset: str, table: str) -> dict[str, Any]:
        t = self.get_table(conn, dataset, table)
        schema = t.schema()

        columns = []
        for name, dtype in schema.items():
            columns.append(
                {
                    "name": name,
                    "type": str(dtype),
                    "nullable": dtype.nullable if hasattr(dtype, "nullable") else True,
                    "description": None,  # Could be populated from metadata
                }
            )

        return {
            "table_name": table,
            "dataset": dataset,
            "columns": columns,
            "column_count": len(columns),
        }


class PreviewAccessor(DataAccessor):
    """Generates preview.md with the first N rows of data as JSONL.

    Template variables:
        - table_name: Name of the table
        - dataset: Schema/dataset name
        - rows: List of row dictionaries
        - row_count: Number of preview rows
        - columns: List of column info dicts
    """

    def __init__(self, num_rows: int = 10):
        self.num_rows = num_rows

    @property
    def filename(self) -> str:
        return "preview.md"

    @property
    def template_name(self) -> str:
        return "databases/preview.md.j2"

    def get_context(self, conn: BaseBackend, dataset: str, table: str) -> dict[str, Any]:
        t = self.get_table(conn, dataset, table)
        schema = t.schema()
        preview_df = t.limit(self.num_rows).execute()

        rows = []
        for _, row in preview_df.iterrows():
            row_dict = row.to_dict()
            # Convert non-serializable types to strings
            for key, val in row_dict.items():
                if val is not None and not isinstance(val, (str, int, float, bool, list, dict)):
                    row_dict[key] = str(val)
            rows.append(row_dict)

        columns = [{"name": name, "type": str(dtype)} for name, dtype in schema.items()]

        return {
            "table_name": table,
            "dataset": dataset,
            "rows": rows,
            "row_count": len(rows),
            "columns": columns,
        }


class DescriptionAccessor(DataAccessor):
    """Generates description.md with table metadata (row count, column count, etc.).

    Template variables:
        - table_name: Name of the table
        - dataset: Schema/dataset name
        - row_count: Total rows in the table
        - column_count: Number of columns
        - description: Table description (if available)
        - columns: List of column info dicts
    """

    @property
    def filename(self) -> str:
        return "description.md"

    @property
    def template_name(self) -> str:
        return "databases/description.md.j2"

    def get_context(self, conn: BaseBackend, dataset: str, table: str) -> dict[str, Any]:
        t = self.get_table(conn, dataset, table)
        schema = t.schema()

        row_count = t.count().execute()
        columns = [{"name": name, "type": str(dtype)} for name, dtype in schema.items()]

        return {
            "table_name": table,
            "dataset": dataset,
            "row_count": row_count,
            "column_count": len(schema),
            "description": None,  # Could be populated from metadata
            "columns": columns,
        }


class ProfilingAccessor(DataAccessor):
    """Generates profiling.md with column statistics and data profiling.

    Template variables:
        - table_name: Name of the table
        - dataset: Schema/dataset name
        - column_stats: List of dicts with stats for each column:
            - name: Column name
            - type: Data type
            - null_count: Number of nulls
            - unique_count: Number of unique values
            - min_value: Min value (numeric/temporal)
            - max_value: Max value (numeric/temporal)
            - error: Error message if stats couldn't be computed
        - columns: List of column info dicts
    """

    @property
    def filename(self) -> str:
        return "profiling.md"

    @property
    def template_name(self) -> str:
        return "databases/profiling.md.j2"

    def get_context(self, conn: BaseBackend, dataset: str, table: str) -> dict[str, Any]:
        t = self.get_table(conn, dataset, table)
        schema = t.schema()

        column_stats = []
        columns = []

        for name, dtype in schema.items():
            columns.append({"name": name, "type": str(dtype)})
            col = t[name]
            dtype_str = str(dtype)

            stat = {
                "name": name,
                "type": dtype_str,
                "null_count": 0,
                "unique_count": 0,
                "min_value": None,
                "max_value": None,
                "error": None,
            }

            try:
                stat["null_count"] = t.filter(col.isnull()).count().execute()
                stat["unique_count"] = col.nunique().execute()

                if dtype.is_numeric() or dtype.is_temporal():
                    try:
                        min_val = str(col.min().execute())
                        max_val = str(col.max().execute())
                        stat["min_value"] = truncate_middle(min_val, 20)
                        stat["max_value"] = truncate_middle(max_val, 20)
                    except Exception:
                        pass
            except Exception as col_error:
                stat["error"] = str(col_error)

            column_stats.append(stat)

        return {
            "table_name": table,
            "dataset": dataset,
            "column_stats": column_stats,
            "columns": columns,
        }
