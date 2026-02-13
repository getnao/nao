from __future__ import annotations

import fnmatch
from abc import ABC, abstractmethod
from enum import Enum

import pandas as pd
import questionary
from ibis import BaseBackend
from pydantic import BaseModel, Field


class DatabaseType(str, Enum):
    """Supported database types."""

    BIGQUERY = "bigquery"
    DUCKDB = "duckdb"
    DATABRICKS = "databricks"
    SNOWFLAKE = "snowflake"
    MSSQL = "mssql"
    POSTGRES = "postgres"
    REDSHIFT = "redshift"

    @classmethod
    def choices(cls) -> list[questionary.Choice]:
        """Get questionary choices for all database types."""
        return [questionary.Choice(db.value.capitalize(), value=db.value) for db in cls]


class DatabaseAccessor(str, Enum):
    """Available default template accessors for database sync."""

    COLUMNS = "columns"
    DESCRIPTION = "description"
    PREVIEW = "preview"


class DatabaseConfig(BaseModel, ABC):
    """Base configuration for all database backends."""

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
    accessors: list[DatabaseAccessor] = Field(
        default_factory=lambda: list(DatabaseAccessor),
        description="Which default templates to render per table (e.g., ['columns', 'description']). Defaults to all.",
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
        conn = self.connect()
        cursor = conn.raw_sql(sql)  # type: ignore[union-attr]

        if hasattr(cursor, "fetchdf"):
            return cursor.fetchdf()
        if hasattr(cursor, "to_dataframe"):
            return cursor.to_dataframe()

        columns: list[str] = [desc[0] for desc in cursor.description]
        return pd.DataFrame(cursor.fetchall(), columns=columns)  # type: ignore[arg-type]

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
        list_databases = getattr(conn, "list_databases", None)
        if list_databases:
            return list_databases()
        return []

    def fetch_table_description(self, conn: BaseBackend, schema: str, table_name: str) -> str | None:
        """Fetch the table description/comment from the warehouse metadata."""
        return None

    def fetch_column_descriptions(self, conn: BaseBackend, schema: str, table_name: str) -> dict[str, str]:
        """Fetch column descriptions/comments from the warehouse metadata."""
        return {}

    def check_connection(self) -> tuple[bool, str]:
        """Test connectivity to the database. Override in subclasses for custom behavior."""
        try:
            conn = self.connect()
            if list_databases := getattr(conn, "list_databases", None):
                schemas = list_databases()
                return True, f"Connected successfully ({len(schemas)} schemas found)"
            return True, "Connected successfully"
        except Exception as e:
            return False, str(e)
