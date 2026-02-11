from typing import Literal

import ibis
from ibis import BaseBackend
from pydantic import Field

from nao_core.config.exceptions import InitError
from nao_core.ui import ask_text

from .base import DatabaseConfig


class PostgresConfig(DatabaseConfig):
    """PostgreSQL-specific configuration."""

    type: Literal["postgres"] = "postgres"
    host: str = Field(description="PostgreSQL host")
    port: int = Field(default=5432, description="PostgreSQL port")
    database: str = Field(description="Database name")
    user: str = Field(description="Username")
    password: str = Field(description="Password")
    schema_name: str | None = Field(default=None, description="Default schema (optional, uses 'public' if not set)")

    @classmethod
    def promptConfig(cls) -> "PostgresConfig":
        """Interactively prompt the user for PostgreSQL configuration."""
        name = ask_text("Connection name:", default="postgres-prod") or "postgres-prod"
        host = ask_text("Host:", default="localhost") or "localhost"
        port_str = ask_text("Port:", default="5432") or "5432"

        if not port_str.isdigit():
            raise InitError("Port must be a valid integer.")

        database = ask_text("Database name:", required_field=True)
        user = ask_text("Username:", required_field=True)
        password = ask_text("Password:", password=True) or ""
        schema_name = ask_text("Default schema (uses 'public' if empty):")

        return PostgresConfig(
            name=name,
            host=host,
            port=int(port_str),
            database=database,  # type: ignore
            user=user,  # type: ignore
            password=password,
            schema_name=schema_name,
        )

    def connect(self) -> BaseBackend:
        """Create an Ibis PostgreSQL connection."""

        kwargs: dict = {
            "host": self.host,
            "port": self.port,
            "database": self.database,
            "user": self.user,
            "password": self.password,
        }

        if self.schema_name:
            kwargs["schema"] = self.schema_name

        return ibis.postgres.connect(
            **kwargs,
        )

    def get_database_name(self) -> str:
        """Get the database name for Postgres."""
        return self.database

    def get_schemas(self, conn: BaseBackend) -> list[str]:
        if self.schema_name:
            return [self.schema_name]
        list_databases = getattr(conn, "list_databases", None)
        if list_databases:
            schemas = list_databases()
            # Filter out system schemas
            return [s for s in schemas if s not in ("pg_catalog", "information_schema") and not s.startswith("pg_")]
        return []

    def check_connection(self) -> tuple[bool, str]:
        """Test connectivity to PostgreSQL."""
        try:
            conn = self.connect()
            if self.schema_name:
                tables = conn.list_tables()
                return True, f"Connected successfully ({len(tables)} tables found)"
            if list_databases := getattr(conn, "list_databases", None):
                schemas = list_databases()
                return True, f"Connected successfully ({len(schemas)} schemas found)"
            return True, "Connected successfully"
        except Exception as e:
            return False, str(e)
