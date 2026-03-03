import logging
import os
from datetime import datetime, timezone
from typing import Any, Literal

import certifi
import ibis
from ibis import BaseBackend
from pydantic import Field

from nao_core.ui import ask_text

from .base import DatabaseConfig
from .context import DatabaseContext

logger = logging.getLogger(__name__)


class DatabricksDatabaseContext(DatabaseContext):
    """Databricks context with partition and description discovery."""

    def _quote_ident(self, name: object) -> str:
        escaped = str(name).replace("`", "``")
        return f"`{escaped}`"

    def partition_columns(self) -> list[str]:
        try:
            return _get_databricks_partition_columns(self._conn, self._schema, self._table_name)
        except Exception:
            logger.debug("Failed to fetch partition columns for %s.%s", self._schema, self._table_name)
            return []

    def description(self) -> str | None:
        try:
            query = f"""
                SELECT COMMENT FROM INFORMATION_SCHEMA.TABLES
                WHERE TABLE_SCHEMA = '{self._schema}' AND TABLE_NAME = '{self._table_name}'
            """
            row = self._conn.raw_sql(query).fetchone()  # type: ignore[union-attr]
            if row and row[0]:
                return str(row[0]).strip() or None
        except Exception:
            pass
        return None

    def columns(self) -> list[dict[str, Any]]:
        cols = super().columns()
        try:
            col_descs = self._fetch_column_descriptions()
            for col in cols:
                if desc := col_descs.get(col["name"]):
                    col["description"] = desc
        except Exception:
            pass
        return cols

    def _fetch_column_descriptions(self) -> dict[str, str]:
        query = f"""
            SELECT COLUMN_NAME, COMMENT FROM INFORMATION_SCHEMA.COLUMNS
            WHERE TABLE_SCHEMA = '{self._schema}' AND TABLE_NAME = '{self._table_name}'
              AND COMMENT IS NOT NULL AND COMMENT != ''
        """
        rows = self._conn.raw_sql(query).fetchall()  # type: ignore[union-attr]
        return {row[0]: str(row[1]) for row in rows if row[1]}

    def profiling(self) -> dict[str, Any] | None:
        try:
            cols = self.columns()
            if not cols:
                return None

            profiles = []

            partition_cols = self.partition_columns()
            partition_filter = ""
            if partition_cols:
                type_by_column_lower = {
                    str(c["name"]).lower(): self._normalize_type(str(c["type"])).lower() for c in cols
                }

                partition_col_name: str | None = None
                partition_col_type: str | None = None
                for candidate in partition_cols:
                    candidate_type = type_by_column_lower.get(str(candidate).lower())
                    if candidate_type is None:
                        continue
                    if "date" in candidate_type or "timestamp" in candidate_type:
                        partition_col_name = str(candidate)
                        partition_col_type = candidate_type
                        break

                if partition_col_name and partition_col_type:
                    partition_col_sql = self._quote_ident(partition_col_name)
                    if "timestamp" in partition_col_type:
                        partition_filter = f"WHERE {partition_col_sql} >= (CURRENT_TIMESTAMP() - INTERVAL 30 DAYS)"
                    else:
                        partition_filter = f"WHERE {partition_col_sql} >= DATE_SUB(CURRENT_DATE(), {30})"

            total_count = self._row_count_with_filter(partition_filter) if partition_filter else self.row_count()

            schema_sql = self._quote_ident(self._schema)
            table_sql = self._quote_ident(self._table_name)

            for col in cols:
                col_name = col["name"]
                col_type = self._normalize_type(col["type"])  # strips NOT NULL
                col_sql = self._quote_ident(col_name)

                is_numeric = any(
                    t in col_type.lower()
                    for t in ("int", "float", "double", "decimal", "numeric", "real", "long", "short")
                )
                is_integer = self._is_integer_type(col_type)
                is_date = any(t in col_type.lower() for t in ("date", "timestamp", "time"))

                is_numeric_stats_column = is_numeric and not (
                    is_integer and col_name.lower().endswith("_id") and col_name.lower() != "id"
                )

                numeric_aggs = ""
                if is_numeric_stats_column:
                    numeric_aggs = f"""
                        , CAST(MIN({col_sql}) AS STRING) AS col_min
                        , CAST(MAX({col_sql}) AS STRING) AS col_max
                        , AVG(CAST({col_sql} AS DOUBLE)) AS col_mean
                        , STDDEV_POP(CAST({col_sql} AS DOUBLE)) AS col_stddev
                    """
                elif is_date:
                    numeric_aggs = f"""
                        , CAST(MIN({col_sql}) AS STRING) AS col_min
                        , CAST(MAX({col_sql}) AS STRING) AS col_max
                    """

                query = f"""
                    SELECT
                        COUNT(*) - COUNT({col_sql}) AS null_count,
                        COUNT(DISTINCT {col_sql}) AS distinct_count
                        {numeric_aggs}
                    FROM {schema_sql}.{table_sql}
                    {partition_filter}
                """

                row = self._conn.raw_sql(query).fetchone()  # type: ignore[union-attr]
                if not row:
                    continue

                null_count = int(row[0] or 0)
                distinct_count = int(row[1] or 0)

                profile: dict[str, Any] = {
                    "column": col_name,
                    "type": col_type,
                    "total_count": total_count,
                    "null_count": null_count,
                    "null_percentage": round(null_count / total_count * 100, 2) if total_count else None,
                    "distinct_count": distinct_count,
                }

                if is_numeric_stats_column:
                    if row[2] is not None:
                        profile["min"] = int(row[2]) if is_integer else round(float(row[2]), 4)
                    if row[3] is not None:
                        profile["max"] = int(row[3]) if is_integer else round(float(row[3]), 4)
                    if row[4] is not None:
                        profile["mean"] = round(float(row[4]), 4)
                    if row[5] is not None:
                        profile["stddev"] = round(float(row[5]), 4)
                elif is_date:
                    if row[2] is not None:
                        profile["min"] = str(row[2])
                    if row[3] is not None:
                        profile["max"] = str(row[3])

                include_top_values = (
                    distinct_count and distinct_count <= 50 and not is_numeric_stats_column and not is_date
                )
                if include_top_values:
                    top_query = f"""
                        SELECT {col_sql} AS value, COUNT(*) AS count
                        FROM {schema_sql}.{table_sql}
                        {partition_filter}
                        GROUP BY 1
                        ORDER BY 2 DESC, 1 ASC
                        LIMIT 10
                    """
                    top_rows = self._conn.raw_sql(top_query).fetchall()  # type: ignore[union-attr]
                    profile["top_values"] = [
                        {"value": self._json_safe_value(r[0]), "count": int(r[1])} for r in top_rows if r[0] is not None
                    ]

                profiles.append(profile)

            return {
                "computed_at": datetime.now(timezone.utc).isoformat(),
                "columns": profiles,
            }

        except Exception:
            return None

    def _row_count_with_filter(self, where_clause: str) -> int:
        schema_sql = self._quote_ident(self._schema)
        table_sql = self._quote_ident(self._table_name)
        query = f"""
            SELECT COUNT(*)
            FROM {schema_sql}.{table_sql}
            {where_clause}
        """
        row = self._conn.raw_sql(query).fetchone()  # type: ignore[union-attr]
        return int(row[0]) if row and row[0] is not None else 0


def _get_databricks_partition_columns(conn: BaseBackend, schema: str, table: str) -> list[str]:
    query = f"""
        SELECT column_name
        FROM information_schema.columns
        WHERE table_schema = '{schema}' AND table_name = '{table}' AND is_partition_column = 'YES'
    """
    result = conn.raw_sql(query).fetchall()  # type: ignore[union-attr]
    return [row[0] for row in result]


# Ensure Python uses certifi's CA bundle for SSL verification.
# This fixes "certificate verify failed" errors when Python's default CA path is empty.
os.environ.setdefault("SSL_CERT_FILE", certifi.where())
os.environ.setdefault("REQUESTS_CA_BUNDLE", certifi.where())


class DatabricksConfig(DatabaseConfig):
    """Databricks-specific configuration."""

    type: Literal["databricks"] = "databricks"
    server_hostname: str = Field(description="Databricks server hostname (e.g., 'adb-xxxx.azuredatabricks.net')")
    http_path: str = Field(description="HTTP path to the SQL warehouse or cluster")
    access_token: str = Field(description="Databricks personal access token")
    catalog: str | None = Field(default=None, description="Unity Catalog name (optional)")
    schema_name: str | None = Field(
        default=None,
        description="Default schema (optional)",
    )

    @classmethod
    def promptConfig(cls) -> "DatabricksConfig":
        """Interactively prompt the user for Databricks configuration."""
        name = ask_text("Connection name:", default="databricks-prod") or "databricks-prod"
        server_hostname = ask_text("Server hostname (e.g., adb-xxxx.azuredatabricks.net):", required_field=True)
        http_path = ask_text("HTTP path (e.g., /sql/1.0/warehouses/xxxx):", required_field=True)
        access_token = ask_text("Access token:", password=True, required_field=True)
        catalog = ask_text("Unity Catalog name (optional):")
        schema = ask_text("Default schema (optional):")

        return DatabricksConfig(
            name=name,
            server_hostname=server_hostname,  # type: ignore
            http_path=http_path,  # type: ignore
            access_token=access_token,  # type: ignore
            catalog=catalog,
            schema_name=schema,
        )

    def connect(self) -> BaseBackend:
        """Create an Ibis Databricks connection."""
        kwargs: dict = {
            "server_hostname": self.server_hostname,
            "http_path": self.http_path,
            "access_token": self.access_token,
        }

        if self.catalog:
            kwargs["catalog"] = self.catalog

        if self.schema_name:
            kwargs["schema"] = self.schema_name

        return ibis.databricks.connect(**kwargs)

    def get_database_name(self) -> str:
        """Get the database name for Databricks."""
        return self.catalog or "main"

    def get_schemas(self, conn: BaseBackend) -> list[str]:
        if self.schema_name:
            return [self.schema_name]
        list_databases = getattr(conn, "list_databases", None)
        return list_databases() if list_databases else []

    def create_context(self, conn: BaseBackend, schema: str, table_name: str) -> DatabricksDatabaseContext:
        return DatabricksDatabaseContext(conn, schema, table_name)

    def check_connection(self) -> tuple[bool, str]:
        """Test connectivity to Databricks."""
        conn = None
        try:
            conn = self.connect()
            if self.schema_name:
                tables = conn.list_tables()
                return True, f"Connected successfully ({len(tables)} tables found)"
            if list_databases := getattr(conn, "list_databases", None):
                schemas = list_databases()
                return True, f"Connected successfully ({len(schemas)} schemas found)"
            return True, "Connected successfully"
        except Exception as e:
            return False, str(e)
        finally:
            if conn is not None:
                conn.disconnect()
