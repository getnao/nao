import json
from typing import Literal

import ibis
from ibis import BaseBackend
from pydantic import Field, field_validator

from nao_core.ui import ask_select, ask_text

from .base import DatabaseConfig

BQ_COST_PER_TB = 6.25


class BigQueryConfig(DatabaseConfig):
    """BigQuery-specific configuration."""

    type: Literal["bigquery"] = "bigquery"
    project_id: str = Field(description="GCP project ID")
    dataset_id: str | None = Field(default=None, description="Default BigQuery dataset")
    max_query_cost: float = Field(default=1.0, description="Maximum allowed query cost in USD")
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

    def annotate_query(self, sql: str, *, project_name: str, user_email: str | None = None) -> str:
        """Prepend a SQL comment with project and user metadata for BigQuery audit."""
        lines = [f"-- project: {project_name}"]
        if user_email:
            lines.append(f"-- user: {user_email}")
        lines.append(sql)
        return "\n".join(lines)

    def validate_query_cost(self, connection: BaseBackend, sql: str) -> None:
        """Dry-run the query and reject it if the estimated cost exceeds the limit."""
        from google.cloud import bigquery

        job_config = bigquery.QueryJobConfig(dry_run=True, use_query_cache=False)
        bq_client = getattr(connection, "client")
        job = bq_client.query(sql, job_config=job_config)

        bytes_processed = job.total_bytes_processed
        estimated_cost = (bytes_processed / (1024**4)) * BQ_COST_PER_TB

        if estimated_cost > self.max_query_cost:
            gb_processed = bytes_processed / (1024**3)
            raise ValueError(
                f"Query would scan {gb_processed:.1f} GB (estimated ${estimated_cost:.2f}), "
                f"which exceeds the ${self.max_query_cost:.2f} limit. "
                f"Refine the query to scan less data (e.g. add filters, select fewer columns, use partitions)."
            )

    def get_database_name(self) -> str:
        """Get the database name for BigQuery."""

        return self.project_id
