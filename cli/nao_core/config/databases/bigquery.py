from __future__ import annotations

import json
import logging
from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Any, Literal

from pydantic import Field, PrivateAttr, field_validator

from nao_core.ui import ask_select, ask_text

if TYPE_CHECKING:
    import pandas as pd
    from ibis import BaseBackend

from .base import DatabaseConfig
from .context import DatabaseContext

logger = logging.getLogger(__name__)


@dataclass
class TablePartitionMetadata:
    """Metadata for a single BigQuery table, fetched in a batch per schema."""

    partition_column: str | None
    partition_column_type: str | None  # DATE, TIMESTAMP, DATETIME, INTEGER, etc.
    last_partition_id: str | None  # e.g. "20260310" for DATE partitions
    total_rows: int | None  # from INFORMATION_SCHEMA.PARTITIONS
    require_partition_filter: bool = False
    clustering_columns: list[str] = field(default_factory=list)
    columns: list[dict[str, Any]] | None = None
    description: str | None = None


def _bq_escape_quoted_identifier(name: object) -> str:
    value = str(name)
    value = value.replace("\\", "\\\\")
    value = value.replace("`", "\\`")
    return value


def _bq_path(*parts: object) -> str:
    escaped = ".".join(_bq_escape_quoted_identifier(p) for p in parts)
    return f"`{escaped}`"


def _bq_string_literal(value: object) -> str:
    text = str(value)
    text = text.replace("\\", "\\\\")
    text = text.replace("'", "\\'")
    return f"'{text}'"


class BigQueryDatabaseContext(DatabaseContext):
    """BigQuery context with partition, clustering, and description discovery."""

    def __init__(
        self,
        conn: BaseBackend,
        schema: str,
        table_name: str,
        project_id: str,
        partition_metadata: TablePartitionMetadata | None = None,
        custom_partition_filter: str | None = None,
    ):
        super().__init__(conn, schema, table_name)
        self._project_id = project_id
        self._partition_metadata = partition_metadata
        self._custom_partition_filter = custom_partition_filter

    def partition_columns(self) -> list[str]:
        if self._partition_metadata is not None:
            if self._partition_metadata.partition_column is not None:
                return self._filter_excluded_names([self._partition_metadata.partition_column])
            if self._partition_metadata.columns is not None:
                return []
        try:
            return self._filter_excluded_names(
                _get_bq_partition_only_columns(self._conn, self._project_id, self._schema, self._table_name)
            )
        except Exception:
            logger.debug("Failed to fetch partition columns for %s.%s", self._schema, self._table_name)
            return []

    def clustering_columns(self) -> list[str]:
        if self._partition_metadata is not None:
            if self._partition_metadata.clustering_columns:
                return self._filter_excluded_names(list(self._partition_metadata.clustering_columns))
            if self._partition_metadata.columns is not None:
                return []
        try:
            return self._filter_excluded_names(
                _get_bq_clustering_only_columns(self._conn, self._project_id, self._schema, self._table_name)
            )
        except Exception:
            logger.debug("Failed to fetch clustering columns for %s.%s", self._schema, self._table_name)
            return []

    def description(self) -> str | None:
        if self._partition_metadata is not None and self._partition_metadata.columns is not None:
            return self._partition_metadata.description
        try:
            table_name_literal = _bq_string_literal(self._table_name)
            table_options_path = _bq_path(self._project_id, self._schema, "INFORMATION_SCHEMA", "TABLE_OPTIONS")
            query = f"""
                SELECT option_value
                FROM {table_options_path}
                WHERE table_name = {table_name_literal} AND option_name = 'description'
            """
            for row in self._conn.raw_sql(query):  # type: ignore[union-attr]
                if row[0]:
                    return str(row[0]).strip().strip('"') or None
        except Exception:
            pass
        return None

    def columns(self) -> list[dict[str, Any]]:
        if self._partition_metadata is not None and self._partition_metadata.columns is not None:
            if self._columns_cache is None:
                self._columns_cache = [dict(column) for column in self._partition_metadata.columns]
            return self._filter_excluded_columns(self._columns_cache)

        cols = super().columns()
        try:
            native_types, descriptions = self._fetch_column_metadata()
            for col in cols:
                if native_type := native_types.get(col["name"]):
                    suffix = " NOT NULL" if col["type"].endswith(" NOT NULL") else ""
                    col["type"] = f"{native_type}{suffix}"
                if desc := descriptions.get(col["name"]):
                    col["description"] = desc
        except Exception:
            logger.debug(
                "Failed to fetch column metadata for %s.%s — keeping ibis types", self._schema, self._table_name
            )
        return cols

    def preview(self, limit: int = 10) -> list[dict[str, Any]]:
        """Return the first N rows, applying a partition filter proactively when required."""
        if self._custom_partition_filter:
            return self._run_filtered_preview(self._custom_partition_filter, limit)

        meta = self._partition_metadata
        if meta is not None and meta.require_partition_filter:
            # Partition filter is mandatory — skip unfiltered attempt
            filter_expr = self._build_partition_filter(meta)
            if not filter_expr:
                logger.debug("No partition filter for %s.%s — skipping preview", self._schema, self._table_name)
                return []
            return self._run_filtered_preview(filter_expr, limit)

        # Reactive fallback: try unfiltered, retry with filter on partition error
        try:
            return super().preview(limit)
        except Exception as e:
            if not _is_partition_filter_error(e):
                raise
        filter_expr = self._build_partition_filter(meta) if meta else None
        if not filter_expr and meta is None:
            filter_expr = self._fetch_safe_partition_filter()
        if not filter_expr:
            logger.debug("No partition filter for %s.%s — skipping preview", self._schema, self._table_name)
            return []
        return self._run_filtered_preview(filter_expr, limit)

    def row_count(self) -> int:
        """Return total row count.

        For partitioned tables: queries INFORMATION_SCHEMA.PARTITIONS for a fresh
        SUM of total_rows across all partitions. This is a metadata-only query
        (no data scan) and works even on tables with require_partition_filter=True.

        For non-partitioned tables: uses standard ibis COUNT(*).
        """
        if (
            self._partition_metadata is not None
            and self._partition_metadata.columns is not None
            and self._partition_metadata.total_rows is not None
        ):
            return self._partition_metadata.total_rows

        if not self.is_partitioned():
            try:
                return super().row_count()
            except Exception as e:
                if not _is_partition_filter_error(e):
                    raise
                # Table is partitioned but metadata wasn't fetched — fall through

        try:
            query = f"""
                SELECT SUM(total_rows)
                FROM `{self._project_id}.{self._schema}.INFORMATION_SCHEMA.PARTITIONS`
                WHERE table_name = '{self._table_name}'
            """
            row = next(iter(self._conn.raw_sql(query)), None)  # type: ignore[union-attr]
            if row is not None and row[0] is not None:
                return int(row[0])
        except Exception:
            logger.debug("row_count failed for %s.%s", self._schema, self._table_name)
        return 0

    def _run_filtered_preview(self, filter_expr: str, limit: int) -> list[dict[str, Any]]:
        query = (
            f"SELECT * FROM `{self._project_id}.{self._schema}.{self._table_name}` WHERE {filter_expr} LIMIT {limit}"
        )
        col_names = list(self.table.schema().keys())
        try:
            return [
                self._prepare_preview_row(
                    {name: _coerce(row[i] if i < len(row) else None) for i, name in enumerate(col_names)}
                )
                for row in self._conn.raw_sql(query)  # type: ignore[union-attr]
            ]
        except Exception:
            logger.debug("Filtered preview failed for %s.%s", self._schema, self._table_name)
            return []

    def _build_partition_filter(self, meta: TablePartitionMetadata) -> str | None:
        """Build a WHERE clause from partition metadata."""
        if meta.partition_column is None:
            return None
        col = meta.partition_column
        col_type = (meta.partition_column_type or "").upper()
        is_time_based = "DATE" in col_type or "TIMESTAMP" in col_type or "DATETIME" in col_type

        if is_time_based:
            if meta.last_partition_id:
                return _time_based_partition_filter(col, col_type, meta.last_partition_id)
            # No partition data yet (streaming) — fall back to today's partition
            if "DATE" in col_type and "TIMESTAMP" not in col_type and "DATETIME" not in col_type:
                return f"`{col}` = CURRENT_DATE()"
            return f"DATE(`{col}`) = CURRENT_DATE()"

        # INTEGER range partitions — use the specific partition value when known
        if meta.last_partition_id:
            try:
                return f"`{col}` = {int(meta.last_partition_id)}"
            except ValueError:
                pass
        return f"`{col}` IS NOT NULL"

    def is_partitioned(self) -> bool:
        """Return True if this table has a partition column."""
        if self._partition_metadata is not None:
            return self._partition_metadata.partition_column is not None
        return False

    def requires_partition_filter(self) -> bool:
        """Return True if BigQuery enforces a partition filter on this table."""
        if self._partition_metadata is not None:
            return self._partition_metadata.require_partition_filter
        return False

    def active_partition_filter(self) -> str | None:
        """Return the partition filter expression used for this table, or None."""
        if self._custom_partition_filter:
            return self._custom_partition_filter
        if self._partition_metadata:
            if self._partition_metadata.partition_column is not None:
                return self._build_partition_filter(self._partition_metadata)
            return None
        return self._fetch_safe_partition_filter()

    def _fetch_safe_partition_filter(self) -> str | None:
        """On-demand: query INFORMATION_SCHEMA for this table's partition info and build a filter.

        Used when batch metadata was not available (e.g. streaming-only table missed by batch query).
        Uses the 2nd newest partition (closed/stable) when available, otherwise the newest.
        """
        try:
            part_query = f"""
                SELECT ARRAY_AGG(partition_id ORDER BY partition_id DESC LIMIT 2)
                FROM `{self._project_id}.{self._schema}.INFORMATION_SCHEMA.PARTITIONS`
                WHERE table_name = '{self._table_name}' AND partition_id != '__NULL__'
            """
            first_row = next(iter(self._conn.raw_sql(part_query)), None)  # type: ignore[union-attr]
            partitions = first_row[0] if first_row and first_row[0] else []
            safe_partition_id = partitions[1] if len(partitions) >= 2 else (partitions[0] if partitions else None)

            col_query = f"""
                SELECT column_name, data_type
                FROM `{self._project_id}.{self._schema}.INFORMATION_SCHEMA.COLUMNS`
                WHERE table_name = '{self._table_name}' AND is_partitioning_column = 'YES'
                LIMIT 1
            """
            col_row = next(iter(self._conn.raw_sql(col_query)), None)  # type: ignore[union-attr]
            if col_row is None:
                return None
            col_name, col_type = col_row[0], col_row[1]

            tmp_meta = TablePartitionMetadata(
                partition_column=col_name,
                partition_column_type=col_type,
                last_partition_id=str(safe_partition_id) if safe_partition_id is not None else None,
                total_rows=None,
            )
            return self._build_partition_filter(tmp_meta)
        except Exception:
            logger.debug("_fetch_safe_partition_filter failed for %s.%s", self._schema, self._table_name)
            return None

    def _fetch_column_metadata(self) -> tuple[dict[str, str], dict[str, str]]:
        """Return native BigQuery types and descriptions per column from INFORMATION_SCHEMA.

        Only top-level rows (``field_path = column_name``) are read; ibis normalises
        BigQuery DATETIME/TIMESTAMP into a single timestamp type, so the native ``data_type``
        is what the generated docs must show for the agent to write valid SQL.
        """
        table_name_literal = _bq_string_literal(self._table_name)
        column_paths = _bq_path(self._project_id, self._schema, "INFORMATION_SCHEMA", "COLUMN_FIELD_PATHS")
        query = f"""
            SELECT column_name, field_path, data_type, description
            FROM {column_paths}
            WHERE table_name = {table_name_literal} AND field_path = column_name
        """
        native_types: dict[str, str] = {}
        descriptions: dict[str, str] = {}
        for row in self._conn.raw_sql(query):  # type: ignore[union-attr]
            column_name, field_path, data_type, description = row[0], row[1], row[2], row[3]
            if field_path != column_name:
                continue
            if data_type:
                native_types[column_name] = str(data_type)
            if description:
                descriptions[column_name] = str(description)
        return native_types, descriptions

    def _quote(self, name: str) -> str:
        return f"`{name}`"

    def _cast_float(self, expr: str) -> str:
        return f"CAST({expr} AS FLOAT64)"

    def _partition_filter(self) -> str:
        cols = self.partition_columns()
        if not cols:
            return ""
        col = cols[0]
        col_type = self._resolve_partition_column_type(col)
        if "TIMESTAMP" in col_type:
            return f"`{col}` >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 30 DAY)"
        if "DATETIME" in col_type:
            return f"`{col}` >= DATETIME_SUB(CURRENT_DATETIME(), INTERVAL 30 DAY)"
        return f"`{col}` >= DATE_SUB(CURRENT_DATE(), INTERVAL 30 DAY)"

    def _resolve_partition_column_type(self, col_name: str) -> str:
        """Return the uppercase data type of the partition column."""
        if self._partition_metadata and self._partition_metadata.partition_column_type:
            return self._partition_metadata.partition_column_type.upper()
        try:
            table_literal = _bq_string_literal(self._table_name)
            col_literal = _bq_string_literal(col_name)
            info_path = _bq_path(self._project_id, self._schema, "INFORMATION_SCHEMA", "COLUMNS")
            query = f"""
                SELECT data_type FROM {info_path}
                WHERE table_name = {table_literal} AND column_name = {col_literal}
                LIMIT 1
            """
            row = next(iter(self._conn.raw_sql(query)), None)  # type: ignore[union-attr]
            if row:
                return str(row[0]).upper()
        except Exception:
            logger.debug("Failed to resolve partition column type for %s.%s", self._schema, self._table_name)
        return "DATE"

    def _array_unnest_join(self, table_sql: str, col_sql: str, alias: str) -> str:
        return f"{table_sql}, UNNEST({col_sql}) AS {alias}"

    def _cast_complex_to_string(self, col_sql: str) -> str:
        return f"TO_JSON_STRING({col_sql})"


def _time_based_partition_filter(col: str, col_type: str, partition_id: str) -> str:
    """Build a partition filter for time-based columns, handling all BigQuery granularities."""
    length = len(partition_id)
    is_date_only = "DATE" in col_type and "TIMESTAMP" not in col_type and "DATETIME" not in col_type

    if length >= 8:  # YYYYMMDD or YYYYMMDDHH
        date_str = f"{partition_id[:4]}-{partition_id[4:6]}-{partition_id[6:8]}"
        if is_date_only:
            return f"`{col}` = DATE('{date_str}')"
        return f"DATE(`{col}`) = DATE('{date_str}')"

    if length == 6:  # YYYYMM — monthly
        date_str = f"{partition_id[:4]}-{partition_id[4:6]}-01"
        if is_date_only:
            return f"DATE_TRUNC(`{col}`, MONTH) = DATE('{date_str}')"
        return f"DATE_TRUNC(DATE(`{col}`), MONTH) = DATE('{date_str}')"

    # YYYY — yearly
    return f"EXTRACT(YEAR FROM `{col}`) = {partition_id}"


def _is_partition_filter_error(exc: Exception) -> bool:
    msg = str(exc).lower()
    return "partition" in msg and "filter" in msg


def _coerce(val: Any) -> Any:
    if val is not None and not isinstance(val, (str, int, float, bool, list, dict)):
        return str(val)
    return val


def _get_bq_partition_only_columns(conn: BaseBackend, project_id: str, schema: str, table: str) -> list[str]:
    """Per-context fallback: return only true partition columns (not clustering)."""
    schema_info_path = _bq_path(project_id, schema, "INFORMATION_SCHEMA", "COLUMNS")
    table_name_literal = _bq_string_literal(table)
    query = f"""
        SELECT column_name
        FROM {schema_info_path}
        WHERE table_name = {table_name_literal} AND is_partitioning_column = 'YES'
    """
    return [row[0] for row in conn.raw_sql(query)]  # type: ignore[union-attr]


def _get_bq_clustering_only_columns(conn: BaseBackend, project_id: str, schema: str, table: str) -> list[str]:
    """Per-context fallback: return clustering columns ordered by position."""
    schema_info_path = _bq_path(project_id, schema, "INFORMATION_SCHEMA", "COLUMNS")
    table_name_literal = _bq_string_literal(table)
    query = f"""
        SELECT column_name
        FROM {schema_info_path}
        WHERE table_name = {table_name_literal} AND clustering_ordinal_position IS NOT NULL
        ORDER BY clustering_ordinal_position
    """
    return [row[0] for row in conn.raw_sql(query)]  # type: ignore[union-attr]


class BigQueryConfig(DatabaseConfig):
    """BigQuery-specific configuration."""

    type: Literal["bigquery"] = "bigquery"
    project_id: str = Field(description="GCP project ID")
    dataset_id: str | None = Field(default=None, description="Default BigQuery dataset")
    credentials_path: str | None = Field(
        default=None,
        description="Path to service account JSON file. If not provided, uses Application Default Credentials (ADC)",
    )
    credentials_json: dict | None = Field(
        default=None,
        description="Service account credentials as a dict or JSON string. Takes precedence over credentials_path if both are provided",
    )
    sso: bool = Field(default=False, description="Use Single Sign-On (SSO) for authentication")
    location: str | None = Field(default=None, description="BigQuery location")
    partition_filters: dict[str, str] = Field(
        default={},
        description=(
            "Custom partition filter expressions per table name, used when previewing tables that require a "
            "partition filter. Overrides the automatic last-partition detection. "
            'Example: {"events": "event_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 7 DAY)"}'
        ),
    )
    max_query_size: float | None = Field(
        default=None,
        description=(
            "Maximum query size in GB. If set, a dry run is performed before executing SQL "
            "and an error is raised if the estimated bytes processed exceeds this limit."
        ),
    )

    # Lazy cache: schema -> table_name -> TablePartitionMetadata
    _schema_metadata: dict[str, dict[str, TablePartitionMetadata]] = PrivateAttr(default_factory=dict)

    @field_validator("credentials_json", mode="before")
    @classmethod
    def parse_credentials_json(cls, v: str | dict | None) -> dict | None:
        if v is None:
            return None
        if isinstance(v, dict):
            return v
        if isinstance(v, str):
            return json.loads(v)
        raise ValueError("credentials_json must be a dict or JSON string")

    @classmethod
    def promptConfig(cls) -> "BigQueryConfig":
        """Interactively prompt the user for BigQuery configuration."""
        name = ask_text("Connection name:", default="bigquery-prod") or "bigquery-prod"
        project_id = ask_text("GCP Project ID:", required_field=True)
        dataset_id = ask_text("Default dataset (optional):")

        auth_type = ask_select(
            "Authentication method:",
            choices=[
                "SSO / Application Default Credentials (ADC)",
                "Service account JSON file path",
                "Service account JSON string",
            ],
        )

        credentials_path: str | None = None
        credentials_json: str | None = None
        sso = False

        if auth_type == "SSO / Application Default Credentials (ADC)":
            sso = True
        elif auth_type == "Service account JSON file path":
            credentials_path = ask_text("Path to service account JSON file:", required_field=True)
        elif auth_type == "Service account JSON string":
            credentials_json = ask_text("Service account JSON:", required_field=True)

        max_query_size: float | None = None
        max_query_size_str = ask_text("Maximum query size in GB (optional):")
        if max_query_size_str:
            try:
                max_query_size = float(max_query_size_str)
            except ValueError:
                pass

        return BigQueryConfig(
            name=name,
            project_id=project_id or "",
            dataset_id=dataset_id,
            credentials_path=credentials_path,
            credentials_json=credentials_json,  # type: ignore[arg-type]
            sso=sso,
            max_query_size=max_query_size,
        )

    def execute_sql(self, sql: str, conn: BaseBackend | None = None) -> pd.DataFrame:
        owns_connection = conn is None
        if conn is None:
            conn = self.connect()
        try:
            if self.max_query_size and self.max_query_size > 0:
                self._check_max_query_size(sql, conn)
            cursor = conn.raw_sql(sql)  # type: ignore[union-attr]
            return cursor.to_dataframe(create_bqstorage_client=False)
        finally:
            if owns_connection:
                conn.disconnect()

    def _check_max_query_size(self, sql: str, conn: BaseBackend) -> None:
        assert self.max_query_size is not None
        bytes_limit = int(self.max_query_size * 1024**3)
        estimated_bytes = self._dry_run_bytes(sql, conn)
        estimated_gb = estimated_bytes / 1024**3
        if estimated_bytes > bytes_limit:
            raise ValueError(
                f"Query would process {estimated_bytes:,} bytes ({estimated_gb:.6f} GB), "
                f"which exceeds the configured limit of {self.max_query_size:.6f} GB."
            )

    def _dry_run_bytes(self, sql: str, conn: Any) -> int:
        from google.cloud import bigquery as bq

        job_config = bq.QueryJobConfig(dry_run=True, use_query_cache=False)
        if self.dataset_id:
            job_config.default_dataset = f"{self.project_id}.{self.dataset_id}"
        query_job = conn.client.query(sql, job_config=job_config, location=self.location)
        return query_job.total_bytes_processed or 0

    def connect(self) -> BaseBackend:
        """Create an Ibis BigQuery connection."""
        from nao_core.deps import require_database_backend

        require_database_backend("bigquery")
        import ibis

        kwargs: dict = {"project_id": self.project_id}

        if self.dataset_id:
            kwargs["dataset_id"] = self.dataset_id

        if self.location:
            kwargs["location"] = self.location

        if self.sso:
            kwargs["auth_local_webserver"] = True

        if self.credentials_json:
            from google.oauth2 import service_account

            credentials = service_account.Credentials.from_service_account_info(
                self.credentials_json,
                scopes=["https://www.googleapis.com/auth/bigquery"],
            )
            kwargs["credentials"] = credentials
        elif self.credentials_path:
            from google.oauth2 import service_account

            credentials = service_account.Credentials.from_service_account_file(
                self.credentials_path,
                scopes=["https://www.googleapis.com/auth/bigquery"],
            )
            kwargs["credentials"] = credentials

        return ibis.bigquery.connect(**kwargs)

    def get_database_name(self) -> str:
        """Get the database name for BigQuery."""
        return self.project_id

    def get_schemas(self, conn: BaseBackend) -> list[str]:
        if self.dataset_id:
            return [self.dataset_id]
        list_databases = getattr(conn, "list_databases", None)
        return list_databases() if list_databases else []

    def create_context(self, conn: BaseBackend, schema: str, table_name: str) -> BigQueryDatabaseContext:
        metadata = self._get_table_metadata(conn, schema, table_name)
        custom_filter = self.partition_filters.get(table_name)
        return BigQueryDatabaseContext(
            conn,
            schema,
            table_name,
            project_id=self.project_id,
            partition_metadata=metadata,
            custom_partition_filter=custom_filter,
        )

    def prepare_sync_metadata(
        self,
        conn: BaseBackend,
        schema_tables: dict[str, list[str]],
    ) -> None:
        """Fetch all selected table metadata once per schema before table rendering starts."""
        self._schema_metadata = {
            schema: _fetch_schema_partition_metadata(conn, self.project_id, schema, tables)
            for schema, tables in schema_tables.items()
            if tables
        }

    def clear_sync_metadata(self) -> None:
        self._schema_metadata = {}

    def _get_table_metadata(self, conn: BaseBackend, schema: str, table_name: str) -> TablePartitionMetadata | None:
        """Return cached partition metadata for a table, fetching the full schema batch on first call."""
        if schema not in self._schema_metadata:
            self._schema_metadata[schema] = _fetch_schema_partition_metadata(conn, self.project_id, schema)
        return self._schema_metadata[schema].get(table_name)

    def _default_query_history_sql(self, days: int) -> str | None:
        region = f"region-{self.location}" if self.location else "region-us"
        return (
            f"SELECT query "
            f"FROM `{self.project_id}`.`{region}`.INFORMATION_SCHEMA.JOBS "
            f"WHERE creation_time >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL {days} DAY) "
            f"AND state = 'DONE' "
            f"AND error_result IS NULL "
            f"AND statement_type IN ('SELECT') "
            f"ORDER BY creation_time DESC "
            f"LIMIT 50000"
        )

    def check_connection(self) -> tuple[bool, str]:
        """Test connectivity to BigQuery."""
        conn = None
        try:
            conn = self.connect()
            if self.dataset_id:
                tables = conn.list_tables()
                return True, f"Connected successfully ({len(tables)} tables found)"
            if list_databases := getattr(conn, "list_databases", None):
                schemas = list_databases()
                return True, f"Connected successfully ({len(schemas)} datasets found)"
            return True, "Connected successfully"
        except Exception as e:
            return False, str(e)
        finally:
            if conn is not None:
                conn.disconnect()


def _fetch_schema_partition_metadata(
    conn: BaseBackend,
    project_id: str,
    schema: str,
    table_names: list[str] | None = None,
) -> dict[str, TablePartitionMetadata]:
    """Fetch table metadata for a schema in a small, fixed number of queries."""
    selected_tables = set(table_names or [])
    columns_map: dict[str, list[dict[str, Any]]] = {}
    partition_columns: dict[str, tuple[str, str]] = {}  # table -> (column_name, column_type)
    last_partition_ids: dict[str, str] = {}
    total_rows_map: dict[str, int] = {}
    require_filter_tables: set[str] = set()
    clustering_map: dict[str, list[tuple[int, str]]] = {}
    descriptions: dict[str, str] = {}

    table_filter = ""
    if selected_tables:
        values = ", ".join(_bq_string_literal(table) for table in sorted(selected_tables))
        table_filter = f" AND c.table_name IN ({values})"

    try:
        column_query = f"""
            SELECT
                c.table_name,
                c.column_name,
                c.data_type,
                c.is_nullable,
                p.description AS column_description,
                c.is_partitioning_column,
                c.clustering_ordinal_position,
                c.is_hidden,
                o.description AS table_description,
                o.require_partition_filter
            FROM `{project_id}.{schema}.INFORMATION_SCHEMA.COLUMNS` AS c
            LEFT JOIN `{project_id}.{schema}.INFORMATION_SCHEMA.COLUMN_FIELD_PATHS` AS p
                ON c.table_catalog = p.table_catalog
                AND c.table_schema = p.table_schema
                AND c.table_name = p.table_name
                AND c.column_name = p.column_name
                AND p.field_path = p.column_name
            LEFT JOIN (
                SELECT
                    table_name,
                    MAX(IF(option_name = 'description', option_value, NULL)) AS description,
                    LOGICAL_OR(
                        option_name = 'require_partition_filter' AND LOWER(option_value) = 'true'
                    ) AS require_partition_filter
                FROM `{project_id}.{schema}.INFORMATION_SCHEMA.TABLE_OPTIONS`
                WHERE option_name IN ('description', 'require_partition_filter')
                GROUP BY table_name
            ) AS o ON c.table_name = o.table_name
            WHERE TRUE{table_filter}
            ORDER BY c.table_name, c.ordinal_position
        """
        rows = list(conn.raw_sql(column_query))  # type: ignore[union-attr]
        for row in rows:
            (
                table_name,
                column_name,
                data_type,
                is_nullable,
                column_description,
                is_partitioning,
                clustering_position,
                is_hidden,
                table_description,
                require_partition_filter,
            ) = row
            column_type = str(data_type)
            table_columns = columns_map.setdefault(table_name, [])
            if is_hidden == "NO":
                nullable = is_nullable == "YES" or column_type.upper().startswith("ARRAY<")
                table_columns.append(
                    {
                        "name": column_name,
                        "type": column_type if nullable else f"{column_type} NOT NULL",
                        "nullable": nullable,
                        "description": str(column_description) if column_description else None,
                    }
                )
            if is_partitioning == "YES":
                partition_columns[table_name] = (column_name, column_type)
            if clustering_position is not None:
                clustering_map.setdefault(table_name, []).append((int(clustering_position), column_name))
            if table_description:
                descriptions[table_name] = str(table_description).strip().strip('"')
            if require_partition_filter:
                require_filter_tables.add(table_name)
    except Exception:
        logger.debug("Failed to fetch column metadata for schema %s", schema)
        return {}

    partition_batches = [sorted(selected_tables)[i : i + 1000] for i in range(0, len(selected_tables), 1000)]
    if not partition_batches:
        partition_batches = [[]]
    for batch in partition_batches:
        partition_filter = ""
        if batch:
            values = ", ".join(_bq_string_literal(table) for table in batch)
            partition_filter = f"WHERE table_name IN ({values})"
        try:
            partitions_query = f"""
                SELECT
                    table_name,
                    ARRAY_AGG(
                        IF(partition_id NOT IN ('__NULL__', '__UNPARTITIONED__'), partition_id, NULL)
                        IGNORE NULLS ORDER BY partition_id DESC LIMIT 2
                    ) AS recent_partitions,
                    SUM(total_rows) AS total_rows
                FROM `{project_id}.{schema}.INFORMATION_SCHEMA.PARTITIONS`
                {partition_filter}
                GROUP BY table_name
            """
            rows = list(conn.raw_sql(partitions_query))  # type: ignore[union-attr]
            for row in rows:
                table_name, partitions, total_rows = row
                partitions = partitions or []
                if partitions:
                    safe_partition = partitions[1] if len(partitions) >= 2 else partitions[0]
                    last_partition_ids[table_name] = str(safe_partition)
                total_rows_map[table_name] = int(total_rows or 0)
        except Exception:
            logger.debug("Failed to fetch partition IDs and row counts for schema %s", schema)

    all_tables = selected_tables or set(columns_map)
    result: dict[str, TablePartitionMetadata] = {}
    for table in all_tables:
        col_info = partition_columns.get(table)
        result[table] = TablePartitionMetadata(
            partition_column=col_info[0] if col_info else None,
            partition_column_type=col_info[1] if col_info else None,
            last_partition_id=last_partition_ids.get(table),
            total_rows=total_rows_map.get(table),
            require_partition_filter=table in require_filter_tables,
            clustering_columns=[name for _, name in sorted(clustering_map.get(table, []))],
            columns=columns_map.get(table),
            description=descriptions.get(table),
        )
    return result
