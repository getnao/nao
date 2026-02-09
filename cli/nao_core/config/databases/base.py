from __future__ import annotations

import fnmatch
from abc import ABC, abstractmethod
from enum import Enum

import questionary
from ibis import BaseBackend
from pydantic import BaseModel, Field


class DatabaseType(str, Enum):
    """Supported database types."""

    BIGQUERY = "bigquery"
    DUCKDB = "duckdb"
    DATABRICKS = "databricks"
    SNOWFLAKE = "snowflake"
    POSTGRES = "postgres"
    REDSHIFT = "redshift"

    @classmethod
    def choices(cls) -> list[questionary.Choice]:
        """Get questionary choices for all database types."""
        return [questionary.Choice(db.value.capitalize(), value=db.value) for db in cls]


class AccessorType(str, Enum):
    """Available data accessors for sync."""

    COLUMNS = "columns"
    PREVIEW = "preview"
    DESCRIPTION = "description"
    PROFILING = "profiling"


class DatabaseConfig(BaseModel, ABC):
    """Base configuration for all database backends."""

    name: str = Field(description="A friendly name for this connection")

    # Sync settings
    accessors: list[AccessorType] = Field(
        default=[AccessorType.COLUMNS, AccessorType.PREVIEW, AccessorType.DESCRIPTION],
        description="List of accessors to run during sync (columns, preview, description, profiling)",
    )
    include: list[str] = Field(
        default_factory=list,
        description="Glob patterns for schemas/tables to include (e.g., 'prod_*.*', 'analytics.dim_*'). Empty means include all.",
    )
    exclude: list[str] = Field(
        default_factory=list,
        description="Glob patterns for schemas/tables to exclude (e.g., 'temp_*.*', '*.backup_*')",
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
