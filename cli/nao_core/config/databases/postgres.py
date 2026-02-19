from typing import Any, Literal

import ibis
from ibis import BaseBackend
from pydantic import Field

from nao_core.config.exceptions import InitError
from nao_core.ui import ask_text

from .base import DatabaseConfig
from .context import DatabaseContext


class PostgresDatabaseContext(DatabaseContext):
    """Postgres context with pg_catalog description discovery."""

    def description(self) -> str | None:
        try:
            query = f"""
                SELECT d.description
                FROM pg_catalog.pg_description d
                JOIN pg_catalog.pg_class c ON c.oid = d.objoid
                JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
                WHERE n.nspname = '{self._schema}' AND c.relname = '{self._table_name}' AND d.objsubid = 0
            """
            row = self._conn.raw_sql(query).fetchone()  # type: ignore[union-attr]
            if row and row[0]:
                return str(row[0]).strip() or None
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
            SELECT a.attname, d.description
            FROM pg_catalog.pg_description d
            JOIN pg_catalog.pg_class c ON c.oid = d.objoid
            JOIN pg_catalog.pg_attribute a ON a.attrelid = c.oid AND a.attnum = d.objsubid
            JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = '{self._schema}' AND c.relname = '{self._table_name}' AND d.objsubid > 0
        """
        rows = self._conn.raw_sql(query).fetchall()  # type: ignore[union-attr]
        return {row[0]: str(row[1]) for row in rows if row[1]}


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

    def create_context(self, conn: BaseBackend, schema: str, table_name: str) -> PostgresDatabaseContext:
        return PostgresDatabaseContext(conn, schema, table_name)

    def check_connection(self) -> tuple[bool, str]:
        """Test connectivity to PostgreSQL."""
        conn = None
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
        finally:
            if conn is not None:
                conn.disconnect()
