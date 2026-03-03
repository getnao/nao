import logging
import os
import re
from datetime import datetime, timezone
from typing import Any, Literal

import ibis
from cryptography.hazmat.backends import default_backend
from cryptography.hazmat.primitives import serialization
from ibis import BaseBackend
from pydantic import Field

from nao_core.config.exceptions import InitError
from nao_core.ui import UI, ask_confirm, ask_text

from .base import DatabaseConfig
from .context import DatabaseContext

logger = logging.getLogger(__name__)


class SnowflakeDatabaseContext(DatabaseContext):
    """Snowflake context with clustering key and description discovery."""

    def partition_columns(self) -> list[str]:
        try:
            return _get_snowflake_clustering_columns(self._conn, self._schema, self._table_name)
        except Exception:
            logger.debug("Failed to fetch clustering keys for %s.%s", self._schema, self._table_name)
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

            clustering_cols = self.partition_columns()
            partition_filter = ""
            if clustering_cols:
                type_by_column_lower = {
                    str(c["name"]).lower(): self._normalize_type(str(c["type"])).lower() for c in cols
                }

                clustering_col_name: str | None = None
                clustering_col_type: str | None = None
                for candidate in clustering_cols:
                    candidate_type = type_by_column_lower.get(str(candidate).lower())
                    if candidate_type is None:
                        continue
                    if "date" in candidate_type or "timestamp" in candidate_type:
                        clustering_col_name = str(candidate)
                        clustering_col_type = candidate_type
                        break

                if clustering_col_name and clustering_col_type:
                    clustering_col_sql = self._quote_ident(clustering_col_name)
                    if "timestamp" in clustering_col_type:
                        partition_filter = f"WHERE {clustering_col_sql} >= DATEADD(day, -30, CURRENT_TIMESTAMP())"
                    else:
                        partition_filter = f"WHERE {clustering_col_sql} >= DATEADD(day, -30, CURRENT_DATE())"

            total_count = self._row_count_with_filter(partition_filter) if partition_filter else self.row_count()
            profiles = []

            schema_sql = self._quote_ident(self._schema)
            table_sql = self._quote_ident(self._table_name)

            for col in cols:
                col_name = col["name"]
                col_type = self._normalize_type(col["type"])  # strips NOT NULL, normalizes
                col_sql = self._quote_ident(col_name)

                is_numeric = self._is_numeric_type(col_type)
                is_integer = self._is_integer_type(col_type)
                is_date = any(t in col_type.lower() for t in ("date", "timestamp", "time"))

                is_numeric_stats_column = is_numeric and not (
                    is_integer and col_name.lower().endswith("_id") and col_name.lower() != "id"
                )

                numeric_aggs = ""
                if is_numeric or is_date:
                    numeric_aggs = f"""
                        , MIN("{col_name}") AS col_min
                        , MAX("{col_name}") AS col_max
                    """
                if is_numeric:
                    numeric_aggs += f"""
                        , AVG("{col_name}"::FLOAT) AS col_mean
                        , STDDEV_POP("{col_name}"::FLOAT) AS col_stddev
                    """

                numeric_aggs = (
                    f"""
                    , TO_VARCHAR(MIN({col_sql})) AS col_min
                    , TO_VARCHAR(MAX({col_sql})) AS col_max
                    , AVG({col_sql}::FLOAT) AS col_mean
                    , STDDEV_POP({col_sql}::FLOAT) AS col_stddev
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

                profile: dict[str, Any] = {
                    "column": col_name.lower(),  # <-- lowercase
                    "type": col_type,  # <-- normalized
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


def _get_snowflake_clustering_columns(conn: BaseBackend, schema: str, table: str) -> list[str]:
    query = f"""
        SELECT clustering_key
        FROM information_schema.tables
        WHERE table_schema = '{schema}' AND table_name = '{table}'
    """
    result = conn.raw_sql(query).fetchone()  # type: ignore[union-attr]
    if not result or not result[0]:
        return []
    return _parse_clustering_key(result[0])


def _parse_clustering_key(clustering_key: str) -> list[str]:
    """Parse Snowflake clustering key string like 'LINEAR(col1, col2)' into column names."""
    match = re.search(r"\((.+)\)", clustering_key)
    if not match:
        return []
    return [col.strip().strip('"') for col in match.group(1).split(",")]


class SnowflakeConfig(DatabaseConfig):
    """Snowflake-specific configuration."""

    type: Literal["snowflake"] = "snowflake"
    username: str = Field(description="Snowflake username")
    account_id: str = Field(description="Snowflake account identifier (e.g., 'xy12345.us-east-1')")
    password: str | None = Field(default=None, description="Snowflake password")
    database: str = Field(description="Snowflake database")
    schema_name: str | None = Field(
        default=None,
        description="Snowflake schema (optional)",
    )
    warehouse: str | None = Field(default=None, description="Snowflake warehouse to use (optional)")
    private_key_path: str | None = Field(
        default=None,
        description="Path to private key file for key-pair authentication",
    )
    passphrase: str | None = Field(
        default=None,
        description="Passphrase for the private key if it is encrypted",
    )
    authenticator: Literal["externalbrowser", "username_password_mfa", "jwt_token", "oauth"] | None = Field(
        default=None,
        description="Authentication method (e.g., 'externalbrowser' for SSO)",
    )

    @classmethod
    def promptConfig(cls) -> "SnowflakeConfig":
        """Interactively prompt the user for Snowflake configuration."""
        name = ask_text("Connection name:", default="snowflake-prod") or "snowflake-prod"
        username = ask_text("Snowflake username:", required_field=True)
        account_id = ask_text("Account identifier (e.g., xy12345.us-east-1):", required_field=True)
        database = ask_text("Snowflake database:", required_field=True)
        warehouse = ask_text("Warehouse (optional):")
        schema = ask_text("Default schema (optional):")

        use_sso = ask_confirm("Use SSO (external browser) for authentication?", default=False)
        key_pair_auth = False if use_sso else ask_confirm("Use key-pair authentication?", default=False)
        authenticator = "externalbrowser" if use_sso else None

        if key_pair_auth:
            private_key_path = ask_text("Path to private key file:", required_field=True)
            if not private_key_path or not os.path.isfile(private_key_path):
                raise InitError(f"Private key file not found: {private_key_path}")
            passphrase = ask_text("Private key passphrase (optional):", password=True)
            password = None
        else:
            password = None if use_sso else ask_text("Snowflake password:", password=True, required_field=True)
            if not use_sso and not password:
                raise InitError("Snowflake password cannot be empty.")
            private_key_path = None
            passphrase = None

        return SnowflakeConfig(
            name=name,
            username=username or "",
            password=password,
            account_id=account_id or "",
            database=database or "",
            warehouse=warehouse,
            schema_name=schema,
            private_key_path=private_key_path,
            passphrase=passphrase,
            authenticator=authenticator,
        )

    def connect(self) -> BaseBackend:
        """Create an Ibis Snowflake connection."""
        kwargs: dict = {"user": self.username}
        kwargs["account"] = self.account_id

        # Always connect to just the database, not database/schema
        # The sync provider will handle schema filtering via list_tables(database=schema)
        if self.database:
            kwargs["database"] = self.database

        if self.warehouse:
            kwargs["warehouse"] = self.warehouse

        # Add authenticator if using SSO (external browser)
        if self.authenticator:
            kwargs["authenticator"] = self.authenticator
            UI.info(f"[yellow]Using authenticator: {self.authenticator}[/yellow]")

        if self.private_key_path:
            with open(self.private_key_path, "rb") as key_file:
                private_key = serialization.load_pem_private_key(
                    key_file.read(),
                    password=self.passphrase.encode() if self.passphrase else None,
                    backend=default_backend(),
                )
                # Convert to DER format which Snowflake expects
                kwargs["private_key"] = private_key.private_bytes(
                    encoding=serialization.Encoding.DER,
                    format=serialization.PrivateFormat.PKCS8,
                    encryption_algorithm=serialization.NoEncryption(),
                )
        elif self.password:
            kwargs["password"] = self.password

        return ibis.snowflake.connect(**kwargs, create_object_udfs=False)

    def get_database_name(self) -> str:
        """Get the database name for Snowflake."""
        return self.database

    def matches_pattern(self, schema: str, table: str) -> bool:
        """Check if a schema.table matches the include/exclude patterns.

        Snowflake identifier matching is case-insensitive.
        """
        from fnmatch import fnmatch

        full_name = f"{schema}.{table}"
        full_name_lower = full_name.lower()

        # If include patterns exist, table must match at least one
        if self.include:
            included = any(fnmatch(full_name_lower, pattern.lower()) for pattern in self.include)
            if not included:
                return False

        # If exclude patterns exist, table must not match any
        if self.exclude:
            excluded = any(fnmatch(full_name_lower, pattern.lower()) for pattern in self.exclude)
            if excluded:
                return False

        return True

    def _schema_matches(self, schema: str) -> bool:
        """Check if a schema could have any matching tables based on include/exclude patterns."""
        from fnmatch import fnmatch

        schema_lower = schema.lower()

        if self.include:
            included = any(fnmatch(schema_lower, p.split(".")[0].lower()) for p in self.include)
            if not included:
                return False

        if self.exclude:
            excluded = any(fnmatch(schema_lower, p.split(".")[0].lower()) for p in self.exclude if p.endswith(".*"))
            if excluded:
                return False

        return True

    def get_schemas(self, conn: BaseBackend) -> list[str]:
        if self.schema_name:
            return [self.schema_name.upper()]
        list_databases = getattr(conn, "list_databases", None)
        schemas = list_databases() if list_databases else []
        schemas = [s for s in schemas if s != "INFORMATION_SCHEMA"]
        return [s for s in schemas if self._schema_matches(s)]

    def create_context(self, conn: BaseBackend, schema: str, table_name: str) -> SnowflakeDatabaseContext:
        return SnowflakeDatabaseContext(conn, schema, table_name)

    def check_connection(self) -> tuple[bool, str]:
        """Test connectivity to Snowflake."""
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
