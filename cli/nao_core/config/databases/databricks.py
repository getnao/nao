from typing import Literal

import ibis
from ibis import BaseBackend
from pydantic import Field
from rich.prompt import Prompt

from nao_core.config.exceptions import InitError

from .base import DatabaseConfig, console


class DatabricksConfig(DatabaseConfig):
    """Databricks-specific configuration."""

    type: Literal["databricks"] = "databricks"
    server_hostname: str = Field(description="Databricks server hostname (e.g., 'adb-xxxx.azuredatabricks.net')")
    http_path: str = Field(description="HTTP path to the SQL warehouse or cluster")
    access_token: str = Field(description="Databricks personal access token")
    catalog: str | None = Field(default=None, description="Unity Catalog name (optional)")
    schema_name: str | None = Field(
        default=None,
        validation_alias="schema",
        serialization_alias="schema",
        description="Default schema (optional)",
    )

    @classmethod
    def promptConfig(cls) -> "DatabricksConfig":
        """Interactively prompt the user for Databricks configuration."""
        console.print("\n[bold cyan]Databricks Configuration[/bold cyan]\n")

        name = Prompt.ask("[bold]Connection name[/bold]", default="databricks-prod")

        server_hostname = Prompt.ask("[bold]Server hostname[/bold] [dim](e.g., adb-xxxx.azuredatabricks.net)[/dim]")
        if not server_hostname:
            raise InitError("Server hostname cannot be empty.")

        http_path = Prompt.ask("[bold]HTTP path[/bold] [dim](e.g., /sql/1.0/warehouses/xxxx)[/dim]")
        if not http_path:
            raise InitError("HTTP path cannot be empty.")

        access_token = Prompt.ask("[bold]Access token[/bold]", password=True)
        if not access_token:
            raise InitError("Access token cannot be empty.")

        catalog = Prompt.ask("[bold]Catalog[/bold] [dim](optional, press Enter to skip)[/dim]", default=None)

        schema = Prompt.ask("[bold]Default schema[/bold] [dim](optional, press Enter to skip)[/dim]", default=None)

        return DatabricksConfig(
            name=name,
            server_hostname=server_hostname,
            http_path=http_path,
            access_token=access_token,
            catalog=catalog,
            schema_name=schema,
        )

    def connect(self) -> BaseBackend:
        """Create an Ibis Databricks connection."""
        kwargs: dict = {
            "server_hostname": self.server_hostname,
            "http_path": self.http_path,
            "access_token": self.access_token,
        }

        if self.catalog:
            kwargs["catalog"] = self.catalog

        if self.schema_name:
            kwargs["schema"] = self.schema_name

        return ibis.databricks.connect(**kwargs)

    def get_database_name(self) -> str:
        """Get the database name for Databricks."""

        return self.catalog or "main"
