import json
import logging
from typing import Any, Literal

import ibis
from ibis import BaseBackend
from pydantic import Field, field_validator

from nao_core.ui import ask_select, ask_text

from .base import DatabaseConfig
from .context import DatabaseContext

logger = logging.getLogger(__name__)


class BigQueryDatabaseContext(DatabaseContext):
    """BigQuery context with partition, clustering, and description discovery."""

    def __init__(self, conn: BaseBackend, schema: str, table_name: str, project_id: str):
        super().__init__(conn, schema, table_name)
        self._project_id = project_id

    def partition_columns(self) -> list[str]:
        try:
            return _get_bq_partition_columns(self._conn, self._schema, self._table_name)
        except Exception:
            logger.debug("Failed to fetch partition columns for %s.%s", self._schema, self._table_name)
            return []

    def description(self) -> str | None:
        try:
            query = f"""
                SELECT option_value
                FROM `{self._project_id}.{self._schema}.INFORMATION_SCHEMA.TABLE_OPTIONS`
                WHERE table_name = '{self._table_name}' AND option_name = 'description'
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

    def _fetch_column_descriptions(self) -> dict[str, str]:
        query = f"""
            SELECT column_name, description
            FROM `{self._project_id}.{self._schema}.INFORMATION_SCHEMA.COLUMN_FIELD_PATHS`
            WHERE table_name = '{self._table_name}' AND description IS NOT NULL AND description != ''
        """
        return {row[0]: str(row[1]) for row in self._conn.raw_sql(query) if row[1]}  # type: ignore[union-attr]


def _get_bq_partition_columns(conn: BaseBackend, schema: str, table: str) -> list[str]:
    partition_query = f"""
        SELECT column_name
        FROM `{schema}.INFORMATION_SCHEMA.COLUMNS`
        WHERE table_name = '{table}' AND is_partitioning_column = 'YES'
    """
    clustering_query = f"""
        SELECT column_name
        FROM `{schema}.INFORMATION_SCHEMA.COLUMNS`
        WHERE table_name = '{table}' AND clustering_ordinal_position IS NOT NULL
        ORDER BY clustering_ordinal_position
    """
    columns: list[str] = []

    result = conn.raw_sql(partition_query).fetchall()  # type: ignore[union-attr]
    columns.extend(row[0] for row in result)

    result = conn.raw_sql(clustering_query).fetchall()  # type: ignore[union-attr]
    columns.extend(row[0] for row in result if row[0] not in columns)

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
        return BigQueryDatabaseContext(conn, schema, table_name, project_id=self.project_id)

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
