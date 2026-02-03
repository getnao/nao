from pathlib import Path
from typing import Literal

import ibis
from ibis import BaseBackend
from pydantic import BaseModel, Field
from sshtunnel import SSHTunnelForwarder

from nao_core.config.exceptions import InitError
from nao_core.ui import ask_confirm, ask_text

from .base import DatabaseConfig


class RedshiftConfig(DatabaseConfig):
    """Amazon Redshift-specific configuration."""

    type: Literal["redshift"] = "redshift"
    host: str = Field(description="Redshift cluster endpoint")
    port: int = Field(default=5439, description="Redshift port")
    database: str = Field(description="Database name")
    user: str = Field(description="Username")
    password: str = Field(description="Password")
    schema_name: str | None = Field(default=None, description="Default schema (optional, uses 'public' if not set)")
    sslmode: str = Field(default="require", description="SSL mode for the connection")

    @classmethod
    def promptConfig(cls) -> "RedshiftConfig":
        """Interactively prompt the user for Redshift configuration."""
        name = ask_text("Connection name:", default="redshift-prod") or "redshift-prod"
        host = ask_text("Cluster endpoint (e.g., your-cluster.region.redshift.amazonaws.com):", required_field=True)
        port_str = ask_text("Port:", default="5439") or "5439"

        if not port_str.isdigit():
            raise InitError("Port must be a valid integer.")

        database = ask_text("Database name:", required_field=True)
        user = ask_text("Username:", required_field=True)
        password = ask_text("Password:", password=True, required_field=True)
        sslmode = ask_text("SSL mode:", default="require") or "require"
        schema_name = ask_text("Default schema (uses 'public' if empty):")

        return RedshiftConfig(
            name=name,
            host=host or "",
            port=int(port_str),
            database=database or "",
            user=user or "",
            password=password or "",
            schema_name=schema_name,
            sslmode=sslmode,
        )

    def connect(self) -> BaseBackend:
        """Create an Ibis Redshift connection."""

        kwargs: dict = {
            "host": self.host,
            "port": self.port,
            "database": self.database,
            "user": self.user,
            "password": self.password,
            "client_encoding": "utf8",
            "sslmode": self.sslmode,
        }

        if self.schema_name:
            kwargs["schema"] = self.schema_name

        return ibis.postgres.connect(
            **kwargs,
        )

    def get_database_name(self) -> str:
        """Get the database name for Redshift."""

        return self.database