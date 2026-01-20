from typing import Literal

import ibis
from ibis import BaseBackend
from pydantic import Field
from rich.prompt import Prompt

from nao_core.config.exceptions import InitError

from .base import DatabaseConfig, console


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

    @classmethod
    def promptConfig(cls) -> "BigQueryConfig":
        """Interactively prompt the user for BigQuery configuration."""
        console.print("\n[bold cyan]BigQuery Configuration[/bold cyan]\n")

        name = Prompt.ask("[bold]Connection name[/bold]", default="bigquery-prod")

        project_id = Prompt.ask("[bold]GCP Project ID[/bold]")
        if not project_id:
            raise InitError("GCP Project ID cannot be empty.")

        dataset_id = Prompt.ask("[bold]Default dataset[/bold] [dim](optional, press Enter to skip)[/dim]", default="")

        credentials_path = Prompt.ask(
            "[bold]Service account JSON path[/bold] [dim](optional, uses ADC if empty)[/dim]",
            default="",
        )

        return BigQueryConfig(
            name=name,
            project_id=project_id,
            dataset_id=dataset_id or None,
            credentials_path=credentials_path or None,
        )

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
