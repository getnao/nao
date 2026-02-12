import os
from typing import Literal

import certifi
import ibis
from ibis import BaseBackend
from pydantic import Field

from nao_core.ui import ask_text

from .base import DatabaseConfig

# Ensure Python uses certifi's CA bundle for SSL verification.
# This fixes "certificate verify failed" errors when Python's default CA path is empty.
os.environ.setdefault("SSL_CERT_FILE", certifi.where())
os.environ.setdefault("REQUESTS_CA_BUNDLE", certifi.where())


class DatabricksConfig(DatabaseConfig):
    """Databricks-specific configuration."""

    type: Literal["databricks"] = "databricks"
    server_hostname: str = Field(description="Databricks server hostname (e.g., 'adb-xxxx.azuredatabricks.net')")
    http_path: str = Field(description="HTTP path to the SQL warehouse or cluster")
    access_token: str = Field(description="Databricks personal access token")
    catalog: str | None = Field(default=None, description="Unity Catalog name (optional)")
    schema_name: str | None = Field(
        default=None,
        description="Default schema (optional)",
    )

    @classmethod
    def promptConfig(cls) -> "DatabricksConfig":
        """Interactively prompt the user for Databricks configuration."""
        name = ask_text("Connection name:", default="databricks-prod") or "databricks-prod"
        server_hostname = ask_text("Server hostname (e.g., adb-xxxx.azuredatabricks.net):", required_field=True)
        http_path = ask_text("HTTP path (e.g., /sql/1.0/warehouses/xxxx):", required_field=True)
        access_token = ask_text("Access token:", password=True, required_field=True)
        catalog = ask_text("Unity Catalog name (optional):")
        schema = ask_text("Default schema (optional):")

        return DatabricksConfig(
            name=name,
            server_hostname=server_hostname,  # type: ignore
            http_path=http_path,  # type: ignore
            access_token=access_token,  # type: ignore
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

    def get_schemas(self, conn: BaseBackend) -> list[str]:
        if self.schema_name:
            return [self.schema_name]
        list_databases = getattr(conn, "list_databases", None)
        return list_databases() if list_databases else []

    def fetch_table_description(self, conn: BaseBackend, schema: str, table_name: str) -> str | None:
        try:
            query = f"""
                SELECT COMMENT FROM INFORMATION_SCHEMA.TABLES
                WHERE TABLE_SCHEMA = '{schema}' AND TABLE_NAME = '{table_name}'
            """
            row = conn.raw_sql(query).fetchone()  # type: ignore[union-attr]
            if row and row[0]:
                return str(row[0]).strip() or None
        except Exception:
            pass
        return None

    def fetch_column_descriptions(self, conn: BaseBackend, schema: str, table_name: str) -> dict[str, str]:
        try:
            query = f"""
                SELECT COLUMN_NAME, COMMENT FROM INFORMATION_SCHEMA.COLUMNS
                WHERE TABLE_SCHEMA = '{schema}' AND TABLE_NAME = '{table_name}'
                  AND COMMENT IS NOT NULL AND COMMENT != ''
            """
            rows = conn.raw_sql(query).fetchall()  # type: ignore[union-attr]
            return {row[0]: str(row[1]) for row in rows if row[1]}
        except Exception:
            return {}

    def check_connection(self) -> tuple[bool, str]:
        """Test connectivity to Databricks."""
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
