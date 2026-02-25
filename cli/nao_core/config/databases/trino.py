from typing import Literal

import ibis
from ibis import BaseBackend
from pydantic import Field

from nao_core.config.exceptions import InitError
from nao_core.ui import ask_text

from .base import DatabaseConfig

EXCLUDED_SCHEMAS = {"information_schema", "default", "sys", "pg_catalog", "test"}


def _normalize_schema_name(value: object) -> str:
    """Normalize schema names returned by different Trino drivers/connectors."""
    if value is None:
        return ""
    return str(value).strip().strip('"').strip("'")


def _is_excluded_schema(value: object) -> bool:
    schema = _normalize_schema_name(value).lower()
    return not schema or schema in {"none", "null"} or schema in EXCLUDED_SCHEMAS or schema.startswith("pg_")


class TrinoConfig(DatabaseConfig):
    """Trino-specific configuration."""

    type: Literal["trino"] = "trino"
    host: str = Field(description="Trino coordinator host")
    port: int = Field(default=8080, description="Trino coordinator port")
    catalog: str = Field(description="Catalog name")
    user: str = Field(description="Username")
    schema_name: str | None = Field(default=None, description="Default schema (optional)")
    password: str | None = Field(default=None, description="Password (optional)")

    @classmethod
    def promptConfig(cls) -> "TrinoConfig":
        """Interactively prompt the user for Trino configuration."""
        name = ask_text("Connection name:", default="trino-prod") or "trino-prod"
        host = ask_text("Host:", default="localhost") or "localhost"
        port_str = ask_text("Port:", default="8080") or "8080"

        if not port_str.isdigit():
            raise InitError("Port must be a valid integer.")

        catalog = ask_text("Catalog name:", required_field=True)
        user = ask_text("Username:", required_field=True)
        password = ask_text("Password (optional):", password=True) or None
        schema_name = ask_text("Default schema (optional):")

        return TrinoConfig(
            name=name,
            host=host,
            port=int(port_str),
            catalog=catalog,  # type: ignore[arg-type]
            user=user,  # type: ignore[arg-type]
            password=password,
            schema_name=schema_name,
        )

    def connect(self) -> BaseBackend:
        """Create an Ibis Trino connection."""
        kwargs: dict = {
            "host": self.host,
            "port": self.port,
            "user": self.user,
            "database": self.catalog,
        }

        if self.schema_name:
            kwargs["schema"] = self.schema_name

        if self.password:
            kwargs["password"] = self.password

        return ibis.trino.connect(**kwargs)

    def get_database_name(self) -> str:
        """Get the database name for Trino."""
        return self.catalog

    def get_schemas(self, conn: BaseBackend) -> list[str]:
        if self.schema_name:
            return [self.schema_name]

        # Prefer Trino-native listing to avoid backend-specific list_databases behavior.
        try:
            escaped_catalog = self.catalog.replace('"', '""')
            rows = conn.raw_sql(f'SHOW SCHEMAS FROM "{escaped_catalog}"').fetchall()  # type: ignore[union-attr]
            schemas = [
                _normalize_schema_name(row[0]) for row in rows if row and row[0] and not _is_excluded_schema(row[0])
            ]
            return sorted(set(schemas))
        except Exception:
            pass

        list_databases = getattr(conn, "list_databases", None)
        if list_databases:
            try:
                schemas = [_normalize_schema_name(s) for s in list_databases() if not _is_excluded_schema(s)]
                return sorted(set(schemas))
            except Exception:
                return []

        return []

    def check_connection(self) -> tuple[bool, str]:
        """Test connectivity to Trino."""
        try:
            conn = self.connect()
            if self.schema_name:
                tables = conn.list_tables(database=self.schema_name)
                return True, f"Connected successfully ({len(tables)} tables found)"

            schemas = self.get_schemas(conn)
            return True, f"Connected successfully ({len(schemas)} schemas found)"
        except Exception as e:
            return False, str(e)
