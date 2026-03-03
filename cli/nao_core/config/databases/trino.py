from datetime import datetime, timezone
from typing import Any, Literal

import ibis
from ibis import BaseBackend
from pydantic import Field

from nao_core.config.exceptions import InitError
from nao_core.ui import ask_text

from .base import DatabaseConfig
from .context import DatabaseContext

EXCLUDED_SCHEMAS = {"information_schema", "default", "sys", "pg_catalog", "test"}


def _normalize_schema_name(value: object) -> str:
    """Normalize schema names returned by different Trino drivers/connectors."""
    if value is None:
        return ""
    return str(value).strip().strip('"').strip("'")


def _is_excluded_schema(value: object) -> bool:
    schema = _normalize_schema_name(value).lower()
    return not schema or schema in {"none", "null"} or schema in EXCLUDED_SCHEMAS or schema.startswith("pg_")


class TrinoDatabaseContext(DatabaseContext):
    def profiling(self) -> dict[str, Any] | None:
        try:
            cols = self.columns()
            if not cols:
                return None

            total_count = self.row_count()
            profiles = []

            schema_sql = self._quote_ident(self._schema)
            table_sql = self._quote_ident(self._table_name)

            for col in cols:
                col_name = col["name"]
                col_type = col["type"]
                col_sql = self._quote_ident(col_name)

                is_numeric = any(
                    t in col_type.lower() for t in ("int", "float", "double", "decimal", "numeric", "real")
                )
                is_date = any(t in col_type.lower() for t in ("date", "timestamp", "time"))

                numeric_aggs = (
                    f"""
                    , CAST(MIN({col_sql}) AS VARCHAR) AS col_min
                    , CAST(MAX({col_sql}) AS VARCHAR) AS col_max
                    , AVG(CAST({col_sql} AS DOUBLE)) AS col_mean
                    , STDDEV(CAST({col_sql} AS DOUBLE)) AS col_stddev
                """
                    if is_numeric or is_date
                    else ""
                )

                query = f"""
                    SELECT
                        COUNT(*) - COUNT({col_sql}) AS null_count,
                        COUNT(DISTINCT {col_sql}) AS distinct_count
                        {numeric_aggs}
                    FROM {schema_sql}.{table_sql}
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

                if is_numeric or is_date:
                    if row[2] is not None:
                        profile["min"] = str(row[2])
                    if row[3] is not None:
                        profile["max"] = str(row[3])
                if is_numeric:
                    if row[4] is not None:
                        profile["mean"] = round(float(row[4]), 4)
                    if row[5] is not None:
                        profile["stddev"] = round(float(row[5]), 4)

                if distinct_count and distinct_count <= 50:
                    try:
                        top_query = f"""
                            SELECT CAST({col_sql} AS VARCHAR) AS value, COUNT(*) AS count
                            FROM {schema_sql}.{table_sql}
                            GROUP BY 1
                            ORDER BY 2 DESC
                            LIMIT 10
                        """
                        top_rows = self._conn.raw_sql(top_query).fetchall()  # type: ignore[union-attr]
                        profile["top_values"] = [
                            {"value": row[0], "count": int(row[1])}
                            for row in top_rows
                            if str(row[0]) not in ("None", "nan", "NaT")
                        ]
                    except Exception:
                        pass

                profiles.append(profile)

            return {
                "computed_at": datetime.now(timezone.utc).isoformat(),
                "columns": profiles,
            }

        except Exception:
            return None


class TrinoConfig(DatabaseConfig):
    """Trino-specific configuration."""

    type: Literal["trino"] = "trino"
    host: str = Field(description="Trino coordinator host")
    port: int = Field(default=8080, description="Trino coordinator port")
    catalog: str = Field(description="Catalog name")
    user: str = Field(description="Username")
    schema_name: str | None = Field(default=None, description="Default schema (optional)")
    password: str | None = Field(default=None, description="Password (optional)")

    @classmethod
    def promptConfig(cls) -> "TrinoConfig":
        """Interactively prompt the user for Trino configuration."""
        name = ask_text("Connection name:", default="trino-prod") or "trino-prod"
        host = ask_text("Host:", default="localhost") or "localhost"
        port_str = ask_text("Port:", default="8080") or "8080"

        if not port_str.isdigit():
            raise InitError("Port must be a valid integer.")

        catalog = ask_text("Catalog name:", required_field=True)
        user = ask_text("Username:", required_field=True)
        password = ask_text("Password (optional):", password=True) or None
        schema_name = ask_text("Default schema (optional):")

        return TrinoConfig(
            name=name,
            host=host,
            port=int(port_str),
            catalog=catalog,  # type: ignore[arg-type]
            user=user,  # type: ignore[arg-type]
            password=password,
            schema_name=schema_name,
        )

    def connect(self) -> BaseBackend:
        """Create an Ibis Trino connection."""
        kwargs: dict = {
            "host": self.host,
            "port": self.port,
            "user": self.user,
            "database": self.catalog,
        }

        if self.schema_name:
            kwargs["schema"] = self.schema_name

        if self.password:
            kwargs["password"] = self.password

        return ibis.trino.connect(**kwargs)

    def get_database_name(self) -> str:
        """Get the database name for Trino."""
        return self.catalog

    def get_schemas(self, conn: BaseBackend) -> list[str]:
        if self.schema_name:
            return [self.schema_name]

        # Prefer Trino-native listing to avoid backend-specific list_databases behavior.
        try:
            escaped_catalog = self.catalog.replace('"', '""')
            rows = conn.raw_sql(f'SHOW SCHEMAS FROM "{escaped_catalog}"').fetchall()  # type: ignore[union-attr]
            schemas = [
                _normalize_schema_name(row[0]) for row in rows if row and row[0] and not _is_excluded_schema(row[0])
            ]
            return sorted(set(schemas))
        except Exception:
            pass

        list_databases = getattr(conn, "list_databases", None)
        if list_databases:
            try:
                schemas = [_normalize_schema_name(s) for s in list_databases() if not _is_excluded_schema(s)]
                return sorted(set(schemas))
            except Exception:
                return []

        return []

    def check_connection(self) -> tuple[bool, str]:
        """Test connectivity to Trino."""
        try:
            conn = self.connect()
            if self.schema_name:
                tables = conn.list_tables(database=self.schema_name)
                return True, f"Connected successfully ({len(tables)} tables found)"

            schemas = self.get_schemas(conn)
            return True, f"Connected successfully ({len(schemas)} schemas found)"
        except Exception as e:
            return False, str(e)
