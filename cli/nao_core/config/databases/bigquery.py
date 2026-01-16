from typing import Literal

import ibis
from ibis import BaseBackend
from pydantic import Field

from .base import DatabaseConfig


class BigQueryConfig(DatabaseConfig):
    """BigQuery-specific configuration."""

    type: Literal["bigquery"] = "bigquery"
    project_id: str = Field(description="GCP project ID")
    dataset_id: str | None = Field(default=None, description="Default BigQuery dataset")
    credentials_path: str | None = Field(
        default=None,
        description="Path to service account JSON file. If not provided, uses Application Default Credentials (ADC)",
    )
    sso: bool = Field(default=False, description="Use Single Sign-On (SSO) for authentication")
    location: str | None = Field(default=None, description="BigQuery location")

    def connect(self) -> BaseBackend:
        """Create an Ibis BigQuery connection."""
        kwargs: dict = {"project_id": self.project_id}

        if self.dataset_id:
            kwargs["dataset_id"] = self.dataset_id

        if self.sso:
            kwargs["auth_local_webserver"] = True

        if self.credentials_path:
            from google.oauth2 import service_account

            credentials = service_account.Credentials.from_service_account_file(
                self.credentials_path,
                scopes=["https://www.googleapis.com/auth/bigquery"],
            )
            kwargs["credentials"] = credentials

        return ibis.bigquery.connect(**kwargs)
