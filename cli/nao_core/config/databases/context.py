"""Base database context exposing methods available in templates during sync."""

from datetime import date, datetime, timezone
from typing import Any

from dateutil.parser import parse
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
        self._columns_cache: list[dict[str, Any]] | None = None
        self._row_count_cache: int | None = None

    @property
    def table(self):
        if self._table_ref is None:
            self._table_ref = self._conn.table(self._table_name, database=self._schema)
        return self._table_ref

    def columns(self) -> list[dict[str, Any]]:
        if self._columns_cache is None:
            schema = self.table.schema()
            self._columns_cache = [
                {
                    "name": name,
                    "type": (raw[1:] + " NOT NULL" if (raw := str(dtype)).startswith("!") else raw),
                    "nullable": dtype.nullable if hasattr(dtype, "nullable") else True,
                    "description": None,
                }
                for name, dtype in schema.items()
            ]
        return self._columns_cache

    def row_count(self) -> int:
        if self._row_count_cache is None:
            self._row_count_cache = self.table.count().execute()
        return self._row_count_cache

    def column_count(self) -> int:
        return len(self.columns())

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

    def partition_columns(self) -> list[str]:
        """Return partition/clustering column names if available."""
        return []

    def description(self) -> str | None:
        """Return the table description if available."""
        return None

    def profiling(self) -> dict[str, Any] | None:
        """Return profiling data for the table."""
        try:
            cols = self.columns()
            if not cols:
                return None

            total_count = self.row_count()
            profiles = []

            for col in cols:
                col_type = self._normalize_type(col["type"])
                is_numeric = self._is_numeric_stats_column(col)
                is_date = any(t in col_type.lower() for t in ("date", "timestamp", "time"))

                query = self._build_profiling_query(col)
                row = self._fetchone(self._conn.raw_sql(query))  # type: ignore[union-attr]
                if not row:
                    continue

                profile = self._parse_profiling_row(row, col, total_count)

                distinct_count = profile["distinct_count"]
                if distinct_count and distinct_count <= 50 and not is_numeric and not is_date:
                    top_vals = self._fetch_top_values(col)
                    if top_vals:
                        profile["top_values"] = top_vals

                profiles.append(profile)

            return {
                "computed_at": datetime.now(timezone.utc).isoformat(),
                "columns": profiles,
            }

        except Exception:
            return None

    # ─── SQL primitives ───────────────────────────────────────────────────────

    def _quote(self, name: str) -> str:
        return f'"{name}"'

    def _cast_float(self, expr: str) -> str:
        return f"CAST({expr} AS DOUBLE)"

    def _stddev(self, expr: str) -> str:
        return f"STDDEV_POP({expr})"

    def _partition_filter(self) -> str:
        return ""

    def _distinct_count_sql(self, col_sql: str) -> str:
        """How to express COUNT(DISTINCT col) — overridable for MSSQL."""
        return f"COUNT(DISTINCT {col_sql})"

    def _null_count_sql(self, col_sql: str) -> str:
        return f"COUNT(*) - COUNT({col_sql})"

    # ─── query builders ───────────────────────────────────────────────────────

    def _numeric_agg_fragments(self, col_sql: str, col: dict) -> list[tuple[str, str]]:
        """Return (alias, expression) pairs for numeric/date aggregates."""
        col_type = self._normalize_type(col["type"])
        is_numeric = self._is_numeric_stats_column(col)
        is_date = any(t in col_type.lower() for t in ("date", "timestamp", "time"))

        frags = []
        if is_numeric or is_date:
            frags.append(("col_min", f"MIN({col_sql})"))
            frags.append(("col_max", f"MAX({col_sql})"))
        if is_numeric:
            frags.append(("col_mean", f"AVG({self._cast_float(col_sql)})"))
            frags.append(("col_stddev", f"{self._stddev(self._cast_float(col_sql))}"))
        return frags

    def _build_profiling_query(self, col: dict) -> str:
        col_sql = self._quote(col["name"])
        table_sql = f"{self._quote(self._schema)}.{self._quote(self._table_name)}"

        partition_filter = self._partition_filter()
        where_clause = f"WHERE {partition_filter}" if partition_filter else ""

        frags = self._numeric_agg_fragments(col_sql, col)
        extra_aggs = "".join(f"\n    , {expr} AS {alias}" for alias, expr in frags)

        return f"""
            SELECT
                {self._null_count_sql(col_sql)} AS null_count,
                {self._distinct_count_sql(col_sql)} AS distinct_count{extra_aggs}
            FROM {table_sql}
            {where_clause}
        """.strip()

    def _build_top_values_query(self, col: dict) -> str:
        col_sql = self._quote(col["name"])
        table_sql = f"{self._quote(self._schema)}.{self._quote(self._table_name)}"
        partition_filter = self._partition_filter()
        where_clause = f"WHERE {partition_filter}" if partition_filter else ""
        return f"""
            SELECT {col_sql} AS value, COUNT(*) AS cnt
            FROM {table_sql}
            {where_clause}
            GROUP BY {col_sql}
            ORDER BY cnt DESC, {col_sql} ASC
            LIMIT 10
        """.strip()

    # ─── result fetching ──────────────────────────────────────────────────────

    def _fetchone(self, result) -> tuple | None:
        """Normalise raw_sql() results across drivers."""
        if hasattr(result, "__iter__") and not hasattr(result, "fetchone"):
            rows = list(result)
            return tuple(rows[0].values()) if rows else None
        return result.fetchone()

    def _fetchall(self, result) -> list[tuple]:
        """Normalise raw_sql() results across drivers."""
        if hasattr(result, "__iter__") and not hasattr(result, "fetchall"):
            return [tuple(row.values()) for row in result]
        return result.fetchall()

    def _fetch_top_values(self, col: dict) -> list[dict]:
        query = self._build_top_values_query(col)
        try:
            rows = self._fetchall(self._conn.raw_sql(query))  # type: ignore[union-attr]
            return [
                {"value": self._json_safe_value(r[0]), "count": int(r[1])}
                for r in rows
                if r[0] is not None and r[0] != ""
            ]
        except Exception:
            return []

    # ─── parsing ──────────────────────────────────────────────────────────────

    def _parse_profiling_row(self, row, col: dict, total_count: int) -> dict[str, Any]:
        col_type = self._normalize_type(col["type"])
        is_numeric = self._is_numeric_stats_column(col)
        is_date = any(t in col_type.lower() for t in ("date", "timestamp", "time"))

        null_count = int(row[0] or 0)
        distinct_count = int(row[1] or 0)

        profile: dict[str, Any] = {
            "column": col["name"],
            "type": col_type,
            "total_count": total_count,
            "null_count": null_count,
            "null_percentage": round(null_count / total_count * 100, 2) if total_count else None,
            "distinct_count": distinct_count,
        }

        if is_date:
            if row[2] is not None:
                profile["min"] = self._format_date_value(row[2])
            if row[3] is not None:
                profile["max"] = self._format_date_value(row[3])
        if is_numeric:
            if row[2] is not None:
                profile["min"] = str(row[2]) if is_date else row[2]
            if row[3] is not None:
                profile["max"] = str(row[3]) if is_date else row[3]
            if row[4] is not None:
                profile["mean"] = round(float(row[4]), 4)
            if row[5] is not None:
                profile["stddev"] = round(float(row[5]), 4)

        return profile

    def _format_date_value(self, val):
        if val is None:
            return None
        if hasattr(val, "item"):
            try:
                val = val.item()
            except Exception:
                pass
        if isinstance(val, date):
            return f"{val.isoformat()} 00:00:00"
        try:
            return parse(str(val)).isoformat()
        except Exception:
            return str(val)

    # ─── type helpers ─────────────────────────────────────────────────────────

    @staticmethod
    def _normalize_type(col_type: str) -> str:
        normalized = col_type.removesuffix(" NOT NULL")
        lowered = normalized.lower()
        if lowered.startswith("string(") and normalized.endswith(")"):
            return "string"
        if normalized == "int64":
            return "int32"
        return normalized

    @staticmethod
    def _is_numeric_stats_column(col: dict) -> bool:
        col_type = col["type"]
        is_numeric = any(t in col_type.lower() for t in ("int", "float", "decimal", "numeric", "double"))
        is_integer = any(t in col_type.lower() for t in ("int", "integer"))
        return is_numeric and not (is_integer and col["name"].lower().endswith("_id") and col["name"].lower() != "id")

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
