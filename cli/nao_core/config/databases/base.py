from __future__ import annotations

import fnmatch
import warnings
from abc import ABC, abstractmethod
from enum import Enum
from typing import TYPE_CHECKING, cast

import questionary
from pydantic import BaseModel, ConfigDict, Field, model_validator

if TYPE_CHECKING:
    import pandas as pd
    from ibis import BaseBackend


class DatabaseType(str, Enum):
    """Supported database types."""

    ATHENA = "athena"
    BIGQUERY = "bigquery"
    CLICKHOUSE = "clickhouse"
    DUCKDB = "duckdb"
    DATABRICKS = "databricks"
    FABRIC = "fabric"
    SNOWFLAKE = "snowflake"
    MSSQL = "mssql"
    MYSQL = "mysql"
    POSTGRES = "postgres"
    REDSHIFT = "redshift"
    TRINO = "trino"

    @classmethod
    def choices(cls) -> list[questionary.Choice]:
        """Get questionary choices for all database types."""
        return [questionary.Choice(db.value.capitalize(), value=db.value) for db in cls]


class DatabaseTemplate(str, Enum):
    """Available default templates for database sync."""

    COLUMNS = "columns"
    PREVIEW = "preview"
    PROFILING = "profiling"
    AI_SUMMARY = "ai_summary"
    HOW_TO_USE = "how_to_use"


# Backward-compatible alias
DatabaseAccessor = DatabaseTemplate


class ProfilingRefreshPolicy(str, Enum):
    ALWAYS = "always"
    INTERVAL = "interval"
    ONCE = "once"


class ProfilingConfig(BaseModel):
    """Configuration for profiling refresh policy."""

    refresh_policy: ProfilingRefreshPolicy = Field(
        default=ProfilingRefreshPolicy.ALWAYS,
        description="When to recompute profiling: always, interval, or once",
    )
    interval_days: int = Field(
        default=7,
        ge=1,  # strictly positive
        description="Number of days between profiling runs (only used when refresh_policy=interval)",
    )


class DatabaseConfig(BaseModel, ABC):
    """Base configuration for all database backends."""

    model_config = ConfigDict(populate_by_name=True)

    type: str  # Narrowed to Literal in each subclass for discriminated union
    name: str = Field(description="A friendly name for this connection")

    include: list[str] = Field(
        default_factory=list,
        description="Glob patterns for schemas/tables to include (e.g., 'prod_*.*', 'analytics.dim_*'). Empty means include all.",
    )
    exclude: list[str] = Field(
        default_factory=list,
        description="Glob patterns for schemas/tables to exclude (e.g., 'temp_*.*', '*.backup_*')",
    )
    templates: list[DatabaseTemplate] = Field(
        default_factory=lambda: [
            DatabaseTemplate.COLUMNS,
            DatabaseTemplate.HOW_TO_USE,
            DatabaseTemplate.PREVIEW,
        ],
        description=(
            "Which default templates to render per table "
            "(e.g., ['columns', 'how_to_use', 'profiling', 'ai_summary']). "
            "Defaults to ['columns', 'how_to_use', 'preview']."
        ),
    )
    query_history_days: int | None = Field(
        default=None,
        description="Number of days to look back for query history (used by how_to_use template).",
    )

    @model_validator(mode="before")
    @classmethod
    def _migrate_accessors_to_templates(cls, data: dict) -> dict:
        """Accept legacy 'accessors' key as an alias for 'templates', and strip removed values."""
        if isinstance(data, dict) and "accessors" in data and "templates" not in data:
            warnings.warn(
                "The 'accessors' config key is deprecated and will be removed in a future version. "
                "Please rename it to 'templates' in your nao.yaml.",
                FutureWarning,
                stacklevel=2,
            )
            data["templates"] = data.pop("accessors")
        if isinstance(data, dict) and "templates" in data:
            data["templates"] = [t for t in data["templates"] if t != "description"]
        return data

    profiling: ProfilingConfig = Field(
        default_factory=ProfilingConfig,
        description="Profiling refresh policy configuration",
    )

    @classmethod
    @abstractmethod
    def promptConfig(cls) -> DatabaseConfig:
        """Interactively prompt the user for database configuration."""
        ...

    @abstractmethod
    def connect(self) -> BaseBackend:
        """Create an Ibis connection for this database."""
        ...

    def execute_sql(self, sql: str) -> pd.DataFrame:
        """Execute arbitrary SQL and return results as a DataFrame."""
        import pandas as pd  # noqa: F811

        conn = self.connect()
        try:
            cursor = conn.raw_sql(sql)  # type: ignore[union-attr]

            if hasattr(cursor, "fetchdf"):
                return cursor.fetchdf()
            if hasattr(cursor, "to_dataframe"):
                return cursor.to_dataframe()
            if hasattr(cursor, "to_pandas"):
                return cursor.to_pandas()

            # ClickHouse (clickhouse_connect) returns QueryResult with result_rows + column_names
            if hasattr(cursor, "result_rows") and hasattr(cursor, "column_names"):
                columns = list(cursor.column_names)
                return pd.DataFrame(cursor.result_rows, columns=columns)  # type: ignore[arg-type]

            if hasattr(cursor, "description") and cursor.description is not None and hasattr(cursor, "fetchall"):
                columns = [desc[0] for desc in cursor.description]
                return pd.DataFrame([tuple(row) for row in cursor.fetchall()], columns=columns)  # type: ignore[arg-type]

            raise TypeError(
                f"Unsupported raw_sql result type: {type(cursor).__name__}. "
                "Expected cursor with fetchdf, to_dataframe, to_pandas, result_rows/column_names, or description/fetchall."
            )
        finally:
            conn.disconnect()

    def matches_pattern(self, schema: str, table: str) -> bool:
        """Check if a schema.table matches the include/exclude patterns.

        Args:
            schema: The schema/dataset name
            table: The table name

        Returns:
            True if the table should be included, False if excluded
        """
        full_name = f"{schema}.{table}"

        # If include patterns exist, table must match at least one
        if self.include:
            included = any(fnmatch.fnmatch(full_name, pattern) for pattern in self.include)
            if not included:
                return False

        # If exclude patterns exist, table must not match any
        if self.exclude:
            excluded = any(fnmatch.fnmatch(full_name, pattern) for pattern in self.exclude)
            if excluded:
                return False

        return True

    @abstractmethod
    def get_database_name(self) -> str:
        """Get the database name for this database type."""
        ...

    def get_schemas(self, conn: BaseBackend) -> list[str]:
        """Return the list of schemas to sync. Override in subclasses for custom behavior."""
        # Prefer schemas (dataset-like) when available.
        list_schemas = getattr(conn, "list_schemas", None)
        if callable(list_schemas):
            try:
                schemas = cast(list[object], list_schemas())
                return [str(schema) for schema in schemas]
            except TypeError:
                # Some backends require positional/keyword args. Fall back to other discovery.
                pass

        # Fall back to databases/catalogs if schemas aren't supported.
        list_databases = getattr(conn, "list_databases", None)
        if callable(list_databases):
            databases = cast(list[object], list_databases())
            return [str(database) for database in databases]

        return []

    def create_context(self, conn: BaseBackend, schema: str, table_name: str):
        """Create a DatabaseContext for this table. Override in subclasses for custom metadata."""
        from nao_core.config.databases.context import DatabaseContext

        return DatabaseContext(conn, schema, table_name)

    def get_query_history_sql(self, days: int) -> str | None:
        """Return SQL to fetch query history for the last N days.

        The query must return rows with at least a `query_text` column.
        Override in subclasses that support query history introspection.
        Returns None if query history is not supported.
        """
        return None

    def _get_empty_credentials(self) -> list[str]:
        """Get list of empty credential fields that typically cause connection failures."""
        empty = []
        # Check common credential fields
        for field_name in ("password", "api_key", "access_key", "secret_key", "token", "api_token"):
            if hasattr(self, field_name):
                value = getattr(self, field_name)
                if value is None or (isinstance(value, str) and not value.strip()):
                    empty.append(field_name)
        return empty

    def check_connection(self) -> tuple[bool, str]:
        """Test connectivity to the database. Override in subclasses for custom behavior."""
        try:
            conn = self.connect()
            schemas = self.get_schemas(conn)
            if schemas:
                return True, f"Connected successfully ({len(schemas)} schemas found)"
            return True, "Connected successfully"
        except Exception as e:
            error_msg = str(e)
            empty_creds = self._get_empty_credentials()
            if empty_creds and any(
                keyword in error_msg.lower()
                for keyword in ("auth", "password", "credentials", "forbidden", "401", "403", "permission")
            ):
                creds_list = ", ".join(f"'{c}'" for c in empty_creds)
                return False, f"{error_msg} (check if environment variables for {creds_list} are set and non-empty)"
            return False, error_msg
