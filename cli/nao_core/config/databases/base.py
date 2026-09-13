from __future__ import annotations

import fnmatch
import re
import sys
import warnings
from abc import ABC, abstractmethod
from collections.abc import Iterable, Mapping
from enum import Enum
from typing import TYPE_CHECKING, cast

import questionary
from pydantic import BaseModel, ConfigDict, Field, model_validator

if TYPE_CHECKING:
    import pandas as pd
    from ibis import BaseBackend


SQL_FETCH_BATCH_SIZE = 1_000
DEFAULT_SQL_MAX_RESULT_ROWS = 10_000
DEFAULT_SQL_MAX_RESULT_BYTES = 10 * 1024 * 1024


class QueryResultTooLargeError(ValueError):
    """Raised when an execute_sql result exceeds the configured response budget."""


class QueryResultStreamingUnsupportedError(TypeError):
    """Raised when a database driver cannot enforce an execute_sql result budget."""


def _cursor_columns(cursor: object) -> list[str] | None:
    """Return cursor column names for DB-API and BigQuery-style result objects."""
    description = getattr(cursor, "description", None)
    if description is not None:
        return [str(column[0]) for column in description]

    column_names = getattr(cursor, "column_names", None)
    if column_names is not None:
        return [str(column) for column in column_names]

    schema = getattr(cursor, "schema", None)
    if schema is not None:
        return [str(field.name) for field in schema]

    return None


def _normalise_row(row: object, columns: list[str] | None) -> object:
    """Convert driver rows into records pandas can consume without materialising all rows."""
    if isinstance(row, Mapping):
        return row

    if columns is not None:
        try:
            return tuple(row[column] for column in columns)  # type: ignore[index]
        except (IndexError, KeyError, TypeError):
            try:
                return tuple(row[index] for index in range(len(columns)))  # type: ignore[index]
            except (IndexError, KeyError, TypeError):
                pass

    try:
        return tuple(row)  # type: ignore[arg-type]
    except TypeError:
        return (row,)


def _estimate_record_size(record: object) -> int:
    """Estimate decoded Python payload size without retaining another result copy."""
    values = record.values() if isinstance(record, Mapping) else record
    try:
        return sum(_estimate_value_size(value) for value in values)  # type: ignore[arg-type]
    except TypeError:
        return _estimate_value_size(record)


def _estimate_value_size(value: object) -> int:
    if isinstance(value, str):
        return len(value.encode("utf-8"))
    if isinstance(value, bytes):
        return len(value)
    return sys.getsizeof(value)


def dataframe_from_cursor(
    cursor: object,
    *,
    max_rows: int | None = None,
    max_bytes: int | None = None,
    columns: list[str] | None = None,
) -> pd.DataFrame | None:
    """Read a cursor in bounded batches while enforcing an output-size budget.

    Returns ``None`` for result objects which cannot be streamed. Callers with a
    budget must reject those objects rather than falling back to an unbounded
    driver conversion such as ``fetchall`` or ``to_dataframe``.
    """
    import pandas as pd

    fetchmany = getattr(cursor, "fetchmany", None)
    if callable(fetchmany):

        def batches() -> Iterable[Iterable[object]]:
            while batch := fetchmany(SQL_FETCH_BATCH_SIZE):
                yield batch

    elif isinstance(cursor, Iterable):

        def batches() -> Iterable[Iterable[object]]:
            iterator = iter(cursor)
            while True:
                batch: list[object] = []
                for _ in range(SQL_FETCH_BATCH_SIZE):
                    try:
                        batch.append(next(iterator))
                    except StopIteration:
                        break
                if not batch:
                    return
                yield batch

    else:
        return None

    columns = _cursor_columns(cursor) if columns is None else columns
    frames: list[pd.DataFrame] = []
    row_count = 0
    byte_count = 0

    for batch in batches():
        records: list[object] = []
        for row in batch:
            record = _normalise_row(row, columns)
            record_size = _estimate_record_size(record)
            if max_rows is not None and row_count >= max_rows:
                raise QueryResultTooLargeError("Query result exceeds the configured row limit.")
            if max_bytes is not None and byte_count + record_size > max_bytes:
                raise QueryResultTooLargeError("Query result exceeds the configured byte limit.")
            records.append(record)
            row_count += 1
            byte_count += record_size
        if records:
            frames.append(pd.DataFrame.from_records(records, columns=columns))

    if not frames:
        return pd.DataFrame() if columns is None else pd.DataFrame(columns=pd.Index(columns))
    return pd.concat(frames, ignore_index=True)


class DatabaseType(str, Enum):
    """Supported database types."""

    ATHENA = "athena"
    BIGQUERY = "bigquery"
    CLICKHOUSE = "clickhouse"
    DUCKDB = "duckdb"
    MOTHERDUCK = "motherduck"
    DATABRICKS = "databricks"
    FABRIC = "fabric"
    SNOWFLAKE = "snowflake"
    MSSQL = "mssql"
    MYSQL = "mysql"
    POSTGRES = "postgres"
    REDSHIFT = "redshift"
    STARROCKS = "starrocks"
    TRINO = "trino"

    @classmethod
    def _label(cls, db_type: "DatabaseType") -> str:
        """Human-readable label for interactive prompts."""
        labels = {
            cls.BIGQUERY: "BigQuery",
            cls.DUCKDB: "DuckDB",
            cls.MOTHERDUCK: "MotherDuck",
            cls.MSSQL: "MSSQL",
            cls.STARROCKS: "StarRocks",
        }
        return labels.get(db_type, db_type.value.capitalize())

    @classmethod
    def choices(cls) -> list[questionary.Choice]:
        """Get questionary choices for all database types."""
        return [questionary.Choice(cls._label(db), value=db.value) for db in cls]


class DatabaseTemplate(str, Enum):
    """Available default templates for database sync."""

    COLUMNS = "columns"
    PREVIEW = "preview"
    PROFILING = "profiling"
    AI_SUMMARY = "ai_summary"
    QUERY_HISTORY = "query_history"


# Backward-compatible alias
DatabaseAccessor = DatabaseTemplate


class ProfilingRefreshPolicy(str, Enum):
    ALWAYS = "always"
    INTERVAL = "interval"
    ONCE = "once"


class RefreshConfig(BaseModel):
    """Configuration for template refresh policy."""

    refresh_policy: ProfilingRefreshPolicy = Field(
        default=ProfilingRefreshPolicy.ALWAYS,
        description="When to refresh the template: always, interval, or once",
    )
    interval_days: int = Field(
        default=7,
        ge=1,
        description="Number of days between refreshes (only used when refresh_policy=interval)",
    )


class ProfilingConfig(RefreshConfig):
    """Configuration for profiling refresh policy."""


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
    exclude_columns: list[str] = Field(
        default_factory=list,
        description=(
            "Glob patterns for columns to exclude. Patterns are matched against the "
            "fully-qualified 'schema.table.column' name (e.g., '*.version', '*._peerdb_*', "
            "'analytics.events.*_id'). Empty means no columns are excluded."
        ),
    )
    templates: list[DatabaseTemplate] = Field(
        default_factory=lambda: [
            DatabaseTemplate.COLUMNS,
            DatabaseTemplate.QUERY_HISTORY,
            DatabaseTemplate.PREVIEW,
        ],
        description=(
            "Which default templates to render per table "
            "(e.g., ['columns', 'query_history', 'profiling', 'ai_summary']). "
            "Defaults to ['columns', 'query_history', 'preview']."
        ),
    )
    query_history_days: int | None = Field(
        default=None,
        description="Number of days to look back for query history (used by query_history template).",
    )
    query_history_sql: str | None = Field(
        default=None,
        description=(
            "Custom SQL to fetch query history, overriding the built-in query for this database type. "
            "The query must return a `query_text` column. The placeholder `{days}` (if present) is "
            "replaced with the configured `query_history_days` value."
        ),
    )
    query_history_exclude_patterns: list[str] = Field(
        default_factory=list,
        description=(
            "Regex patterns (case-insensitive) used to drop noisy queries fetched from query history. "
            "Any query whose text matches at least one pattern is excluded from the query_history analysis. "
            "Useful to filter out warehouse system queries (e.g. 'SYSTEM\\$', 'CURRENT_SESSION\\(\\)')."
        ),
    )

    @model_validator(mode="before")
    @classmethod
    def _migrate_accessors_to_templates(cls, data: dict) -> dict:
        """Accept legacy configuration names and map them to current equivalents."""
        if isinstance(data, dict) and "accessors" in data and "templates" not in data:
            warnings.warn(
                "The 'accessors' config key is deprecated and will be removed in a future version. "
                "Please rename it to 'templates' in your nao_config.yaml.",
                FutureWarning,
                stacklevel=2,
            )
            data["templates"] = data.pop("accessors")
        if isinstance(data, dict) and "templates" in data:
            templates = data["templates"]
            if "description" in templates:
                warnings.warn(
                    "The 'description' database template is deprecated and will be removed in a future version. "
                    "The table description now lives in 'columns.md'. Please remove 'description' from "
                    "'templates' in your nao_config.yaml.",
                    FutureWarning,
                    stacklevel=2,
                )
            if "how_to_use" in templates:
                warnings.warn(
                    "The 'how_to_use' database template is deprecated and will be removed in a future version. "
                    "Please rename it to 'query_history' in your nao_config.yaml.",
                    FutureWarning,
                    stacklevel=2,
                )
            migrated_templates = [
                "query_history" if template == "how_to_use" else template
                for template in templates
                if template != "description"
            ]
            data["templates"] = list(dict.fromkeys(migrated_templates))
        return data

    profiling: ProfilingConfig = Field(
        default_factory=ProfilingConfig,
        description="Profiling refresh policy configuration",
    )
    ai_summary: RefreshConfig = Field(
        default_factory=RefreshConfig,
        description="AI summary refresh policy configuration",
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

    def execute_sql(
        self,
        sql: str,
        *,
        max_rows: int | None = DEFAULT_SQL_MAX_RESULT_ROWS,
        max_bytes: int | None = DEFAULT_SQL_MAX_RESULT_BYTES,
    ) -> pd.DataFrame:
        """Execute arbitrary SQL and return results as a DataFrame.

        ``max_rows`` and ``max_bytes`` are enforced while fetching, before a
        complete result can be materialised in the worker.
        """
        conn = self.connect()
        try:
            cursor = conn.raw_sql(sql)  # type: ignore[union-attr]

            streamed = dataframe_from_cursor(cursor, max_rows=max_rows, max_bytes=max_bytes)
            if streamed is not None:
                return streamed

            # clickhouse_connect exposes rows only after its driver has read
            # them, but converting those rows in batches still avoids a second
            # full Python list during DataFrame construction.
            if hasattr(cursor, "result_rows") and hasattr(cursor, "column_names"):
                result_rows = cursor.result_rows
                result_columns = [str(column) for column in cursor.column_names]
                streamed_rows = dataframe_from_cursor(
                    iter(result_rows),
                    max_rows=max_rows,
                    max_bytes=max_bytes,
                    columns=result_columns,
                )
                assert streamed_rows is not None
                return streamed_rows

            if max_rows is not None or max_bytes is not None:
                raise QueryResultStreamingUnsupportedError(
                    f"{type(cursor).__name__} cannot stream query results while enforcing a result limit."
                )

            if hasattr(cursor, "fetchdf"):
                return cursor.fetchdf()
            if hasattr(cursor, "to_dataframe"):
                return cursor.to_dataframe()
            if hasattr(cursor, "to_pandas"):
                return cursor.to_pandas()

            raise TypeError(
                f"Unsupported raw_sql result type: {type(cursor).__name__}. "
                "Expected a streamable cursor or a result with fetchdf, to_dataframe, to_pandas, or result_rows/column_names."
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

    def column_matches_pattern(self, schema: str, table: str, column: str) -> bool:
        """Check if a column should be included given the exclude_columns patterns.

        Patterns are matched against the fully-qualified ``schema.table.column``
        name using shell-style globs (``fnmatch``). Returns ``True`` when the
        column should be kept, ``False`` when it should be excluded.
        """
        if not self.exclude_columns:
            return True
        full_name = f"{schema}.{table}.{column}"
        return not any(fnmatch.fnmatch(full_name, pattern) for pattern in self.exclude_columns)

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

        return DatabaseContext(conn, schema, table_name, exclude_columns=self.exclude_columns)

    def get_semantic_views(self, conn: "BaseBackend", schema: str) -> list[dict[str, str]]:
        """Fetch semantic views for a schema. Override in subclasses that support semantic views."""
        return []

    def get_query_history_sql(self, days: int) -> str | None:
        """Return SQL to fetch query history for the last N days.

        Honors a user-defined ``query_history_sql`` override (with ``{days}``
        substitution) when set; otherwise delegates to the database-specific
        default. The query must return rows with at least a ``query_text``
        column. Returns ``None`` when query history is not supported.
        """
        if self.query_history_sql:
            return self._format_custom_query_history_sql(self.query_history_sql, days)
        return self._default_query_history_sql(days)

    def _default_query_history_sql(self, days: int) -> str | None:
        """Built-in query history SQL for this database type.

        Override in subclasses that natively support query history introspection.
        """
        return None

    @staticmethod
    def _format_custom_query_history_sql(sql: str, days: int) -> str:
        """Substitute the ``{days}`` placeholder in a user-provided SQL string.

        Other braces in the SQL are preserved as-is so users can write JSON
        literals or window function calls without escaping every brace.
        """
        if "{days}" not in sql:
            return sql
        return sql.replace("{days}", str(days))

    def filter_query_history(self, queries: list[str]) -> list[str]:
        """Drop queries whose text matches any configured exclude pattern."""
        if not self.query_history_exclude_patterns:
            return queries
        compiled = [re.compile(pattern, re.IGNORECASE) for pattern in self.query_history_exclude_patterns]
        return [q for q in queries if not any(pattern.search(q) for pattern in compiled)]

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
