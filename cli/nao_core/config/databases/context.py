"""Base database context exposing methods available in templates during sync."""

import math
from datetime import datetime, timezone
from typing import Any

import ibis
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

    def profiling(self) -> dict[str, Any] | None:
        """Return column-level profiling statistics for the table."""
        try:
            cols = self.columns()
            if not cols:
                return None

            table = self.table
            total_count = self.row_count()
            profiles: list[dict[str, Any]] = []

            for col in cols:
                col_name = col["name"]
                col_type = self._normalize_type(col["type"])
                column = table[col_name]

                profile: dict[str, Any] = {
                    "column": col_name,
                    "type": col_type,
                    "total_count": total_count,
                    "null_count": int(column.isnull().sum().execute()),
                }

                null_count = profile["null_count"]
                profile["null_percentage"] = round(null_count / total_count * 100, 2) if total_count else None
                profile["distinct_count"] = int(column.nunique().execute())

                is_integer = self._is_integer_type(col_type)
                is_numeric = self._is_numeric_type(col_type)
                is_numeric_stats_column = is_numeric and not (
                    is_integer and col_name.endswith("_id") and col_name != "id"
                )

                if is_numeric_stats_column:
                    profile["min"] = self._json_safe_value(column.min().execute())
                    profile["max"] = self._json_safe_value(column.max().execute())
                    numeric_expr = column.cast("float64") if is_integer else column
                    profile["mean"] = round(float(numeric_expr.mean().execute()), 4)
                    profile["stddev"] = self._round_or_none(self._stddev_pop(numeric_expr), 4)

                is_date = any(t in col_type.lower() for t in ("date", "timestamp", "time"))
                if is_date:
                    profile["min"] = str(column.min().execute())
                    profile["max"] = str(column.max().execute())

                distinct_count = profile["distinct_count"]
                top_values_distinct_limit = 10 if is_date else 50
                include_top_values = (
                    bool(distinct_count)
                    and distinct_count <= top_values_distinct_limit
                    and (not is_numeric_stats_column)
                )
                if include_top_values:
                    filtered_table = table.filter(column.notnull())
                    top = (
                        filtered_table.group_by(col_name)
                        .aggregate(count=filtered_table[col_name].count())
                        .order_by([ibis.desc("count"), ibis.asc(col_name)])
                        .limit(10)
                        .execute()
                    )
                    profile["top_values"] = [
                        {
                            "value": self._json_safe_value(row[col_name]),
                            "count": int(row["count"]),
                        }
                        for _, row in top.iterrows()
                    ]

                profiles.append(profile)

            return {
                "computed_at": datetime.now(timezone.utc).isoformat(),
                "columns": profiles,
            }

        except Exception:
            return None

    @staticmethod
    def _normalize_type(col_type: str) -> str:
        normalized = col_type.removesuffix(" NOT NULL")
        lowered = normalized.lower()
        if lowered.startswith("string(") and normalized.endswith(")"):
            return "string"
        return normalized

    @staticmethod
    def _is_numeric_type(col_type: str) -> bool:
        lowered = col_type.lower()
        return any(t in lowered for t in ("int", "float", "decimal", "numeric", "double"))

    @staticmethod
    def _is_integer_type(col_type: str) -> bool:
        lowered = col_type.lower()
        return "int" in lowered and not any(t in lowered for t in ("float", "double", "decimal", "numeric"))

    @staticmethod
    def _stddev_pop(expr) -> float | None:
        mean_value = expr.mean().execute()
        if mean_value is None:
            return None
        diff = expr - ibis.literal(float(mean_value))
        var_value = (diff * diff).mean().execute()
        if var_value is None:
            return None
        return math.sqrt(float(var_value))

    @staticmethod
    def _round_or_none(value: float | None, digits: int) -> float | None:
        if value is None:
            return None
        return round(float(value), digits)

    @staticmethod
    def _json_safe_value(value: Any) -> Any:
        if value is None:
            return None
        item = getattr(value, "item", None)
        if callable(item):
            try:
                value = item()
            except Exception:
                pass
        if isinstance(value, (str, int, float, bool, list, dict)):
            return value
        return str(value)
