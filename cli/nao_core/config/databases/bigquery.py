# ABOUTME: BigQuery database configuration and context for nao sync.
# ABOUTME: Handles connection, schema discovery, and partition-aware preview/row_count.

import json
import logging
from dataclasses import dataclass
from typing import Any, Literal

import ibis
import pandas as pd
from ibis import BaseBackend
from pydantic import Field, PrivateAttr, field_validator

from nao_core.ui import ask_select, ask_text

from .base import DatabaseConfig
from .context import DatabaseContext

logger = logging.getLogger(__name__)


@dataclass
class TablePartitionMetadata:
    """Partition metadata for a single BigQuery table, fetched in a batch per schema."""

    partition_column: str | None
    partition_column_type: str | None  # DATE, TIMESTAMP, DATETIME, INTEGER, etc.
    last_partition_id: str | None  # e.g. "20260310" for DATE partitions
    total_rows: int | None  # from INFORMATION_SCHEMA.PARTITIONS
    require_partition_filter: bool = False


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
        if self._partition_metadata is not None and self._partition_metadata.partition_column is not None:
            return [self._partition_metadata.partition_column]
        try:
            return _get_bq_partition_columns(self._conn, self._schema, self._table_name)
        except Exception:
            logger.debug("Failed to fetch partition columns for %s.%s", self._schema, self._table_name)
            return []

    def description(self) -> str | None:
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
        cols = super().columns()
        try:
            col_descs = self._fetch_column_descriptions()
            for col in cols:
                if desc := col_descs.get(col["name"]):
                    col["description"] = desc
        except Exception:
            pass
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
                {name: _coerce(row[i] if i < len(row) else None) for i, name in enumerate(col_names)}
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
            return self._build_partition_filter(self._partition_metadata)
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

    def _fetch_column_descriptions(self) -> dict[str, str]:
        table_name_literal = _bq_string_literal(self._table_name)
        column_paths = _bq_path(self._project_id, self._schema, "INFORMATION_SCHEMA", "COLUMN_FIELD_PATHS")
        query = f"""
            SELECT column_name, description
            FROM {column_paths}
            WHERE table_name = {table_name_literal} AND description IS NOT NULL AND description != ''
        """
        return {row[0]: str(row[1]) for row in self._conn.raw_sql(query) if row[1]}  # type: ignore[union-attr]

    def _quote(self, name: str) -> str:
        return f"`{name}`"

    def _cast_float(self, expr: str) -> str:
        return f"CAST({expr} AS FLOAT64)"

    def _partition_filter(self) -> str:
        cols = self.partition_columns()
        if cols:
            return f"`{cols[0]}` >= DATE_SUB(CURRENT_DATE(), INTERVAL 30 DAY)"
        return ""


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


def _get_bq_partition_columns(conn: BaseBackend, schema: str, table: str) -> list[str]:
    schema_info_path = _bq_path(schema, "INFORMATION_SCHEMA", "COLUMNS")
    table_name_literal = _bq_string_literal(table)
    partition_query = f"""
        SELECT column_name
        FROM {schema_info_path}
        WHERE table_name = {table_name_literal} AND is_partitioning_column = 'YES'
    """
    clustering_query = f"""
        SELECT column_name
        FROM {schema_info_path}
        WHERE table_name = {table_name_literal} AND clustering_ordinal_position IS NOT NULL
        ORDER BY clustering_ordinal_position
    """
    columns: list[str] = []

    columns.extend(row[0] for row in conn.raw_sql(partition_query))  # type: ignore[union-attr]
    columns.extend(row[0] for row in conn.raw_sql(clustering_query) if row[0] not in columns)  # type: ignore[union-attr]

    return columns


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

        return BigQueryConfig(
            name=name,
            project_id=project_id or "",
            dataset_id=dataset_id,
            credentials_path=credentials_path,
            credentials_json=credentials_json,  # type: ignore[arg-type]
            sso=sso,
        )

    def execute_sql(self, sql: str) -> pd.DataFrame:
        conn = self.connect()
        try:
            cursor = conn.raw_sql(sql)  # type: ignore[union-attr]
            return cursor.to_dataframe(create_bqstorage_client=False)
        finally:
            conn.disconnect()

    def connect(self) -> BaseBackend:
        """Create an Ibis BigQuery connection."""
        kwargs: dict = {"project_id": self.project_id}

        if self.dataset_id:
            kwargs["dataset_id"] = self.dataset_id

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

    def _get_table_metadata(self, conn: BaseBackend, schema: str, table_name: str) -> TablePartitionMetadata | None:
        """Return cached partition metadata for a table, fetching the full schema batch on first call."""
        if schema not in self._schema_metadata:
            self._schema_metadata[schema] = _fetch_schema_partition_metadata(conn, self.project_id, schema)
        return self._schema_metadata[schema].get(table_name)

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
    conn: BaseBackend, project_id: str, schema: str
) -> dict[str, TablePartitionMetadata]:
    """Fetch partition metadata for all tables in a schema in three batch queries."""
    partition_columns: dict[str, tuple[str, str]] = {}  # table -> (column_name, column_type)
    last_partition_ids: dict[str, str] = {}
    total_rows_map: dict[str, int] = {}
    require_filter_tables: set[str] = set()

    try:
        column_query = f"""
            SELECT table_name, column_name, data_type
            FROM `{project_id}.{schema}.INFORMATION_SCHEMA.COLUMNS`
            WHERE is_partitioning_column = 'YES'
        """
        for row in conn.raw_sql(column_query):  # type: ignore[union-attr]
            partition_columns[row[0]] = (row[1], row[2])
    except Exception:
        logger.debug("Failed to fetch partition column types for schema %s", schema)

    try:
        partitions_query = f"""
            SELECT
                table_name,
                ARRAY_AGG(partition_id ORDER BY partition_id DESC LIMIT 2) AS recent_partitions,
                SUM(total_rows) AS total_rows
            FROM `{project_id}.{schema}.INFORMATION_SCHEMA.PARTITIONS`
            WHERE partition_id != '__NULL__'
            GROUP BY table_name
        """
        for row in conn.raw_sql(partitions_query):  # type: ignore[union-attr]
            partitions = row[1] or []
            if partitions:
                # Use 2nd newest if available (guaranteed closed), otherwise the only one
                safe_partition = partitions[1] if len(partitions) >= 2 else partitions[0]
                last_partition_ids[row[0]] = str(safe_partition)
            if row[2] is not None:
                total_rows_map[row[0]] = int(row[2])
    except Exception:
        logger.debug("Failed to fetch partition IDs for schema %s", schema)

    try:
        require_filter_query = f"""
            SELECT table_name
            FROM `{project_id}.{schema}.INFORMATION_SCHEMA.TABLE_OPTIONS`
            WHERE option_name = 'require_partition_filter' AND option_value = 'true'
        """
        for row in conn.raw_sql(require_filter_query):  # type: ignore[union-attr]
            require_filter_tables.add(row[0])
    except Exception:
        logger.debug("Failed to fetch require_partition_filter flags for schema %s", schema)

    all_tables = set(partition_columns) | set(last_partition_ids)
    result: dict[str, TablePartitionMetadata] = {}
    for table in all_tables:
        col_info = partition_columns.get(table)
        result[table] = TablePartitionMetadata(
            partition_column=col_info[0] if col_info else None,
            partition_column_type=col_info[1] if col_info else None,
            last_partition_id=last_partition_ids.get(table),
            total_rows=total_rows_map.get(table),
            require_partition_filter=table in require_filter_tables,
        )
    return result
