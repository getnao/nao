from pathlib import Path
from typing import Any, Literal

import ibis
from ibis import BaseBackend
from pydantic import BaseModel, Field
from sshtunnel import SSHTunnelForwarder

from nao_core.config.exceptions import InitError
from nao_core.ui import ask_confirm, ask_text

from .base import DatabaseConfig


class RedshiftDatabaseContext:
    """Redshift-specific context that bypasses Ibis's problematic pg_enum queries."""

    def __init__(self, conn: BaseBackend, schema: str, table_name: str):
        self._conn = conn
        self._schema = schema
        self._table_name = table_name
        self._table_ref = None

    @property
    def table(self):
        if self._table_ref is None:
            self._table_ref = self._conn.table(self._table_name, database=self._schema)
        return self._table_ref

    def columns(self) -> list[dict[str, Any]]:
        """Return column metadata by querying information_schema directly."""
        col_descs = self._fetch_column_descriptions()

        query = f"""
            SELECT 
                column_name,
                data_type,
                is_nullable,
                character_maximum_length,
                numeric_precision,
                numeric_scale
            FROM information_schema.columns
            WHERE table_schema = '{self._schema}'
              AND table_name = '{self._table_name}'
            ORDER BY ordinal_position
        """
        result = self._conn.raw_sql(query).fetchall()  # type: ignore[union-attr]

        columns = []
        for row in result:
            col_name = row[0]
            data_type = row[1]
            is_nullable = row[2] == "YES"
            char_length = row[3]
            num_precision = row[4]
            num_scale = row[5]

            # Map SQL types to Ibis-like type strings
            formatted_type = self._format_redshift_type(data_type, is_nullable, char_length, num_precision, num_scale)

            columns.append(
                {
                    "name": col_name,
                    "type": formatted_type,
                    "nullable": is_nullable,
                    "description": col_descs.get(col_name),
                }
            )

        return columns

    @staticmethod
    def _format_redshift_type(
        data_type: str,
        is_nullable: bool,
        char_length: int | None,
        num_precision: int | None,
        num_scale: int | None,
    ) -> str:
        """Convert Redshift SQL type to Ibis-like format."""
        # Map common Redshift types to Ibis types
        type_map = {
            "integer": "int32",
            "bigint": "int64",
            "smallint": "int16",
            "boolean": "boolean",
            "real": "float32",
            "double precision": "float64",
            "character varying": "string",
            "character": "string",
            "text": "string",
            "date": "date",
            "timestamp without time zone": "timestamp",
            "timestamp with time zone": "timestamp",
        }

        ibis_type = type_map.get(data_type, "string")

        if not is_nullable:
            return f"{ibis_type} NOT NULL"
        return ibis_type

    def preview(self, limit: int = 10) -> list[dict[str, Any]]:
        """Return the first N rows as a list of dictionaries."""
        # Use raw SQL to avoid Ibis's pg_enum queries
        query = f'SELECT * FROM "{self._schema}"."{self._table_name}" LIMIT {limit}'
        result = self._conn.raw_sql(query).fetchall()  # type: ignore[union-attr]

        # Get column names from the columns metadata
        columns = self.columns()
        col_names = [col["name"] for col in columns]

        rows = []
        for row in result:
            row_dict = {}
            for i, col_name in enumerate(col_names):
                val = row[i] if i < len(row) else None
                if val is not None and not isinstance(val, (str, int, float, bool, list, dict)):
                    row_dict[col_name] = str(val)
                else:
                    row_dict[col_name] = val
            rows.append(row_dict)
        return rows

    def row_count(self) -> int:
        """Return the total number of rows in the table."""
        # Use raw SQL to avoid Ibis's pg_enum queries
        query = f'SELECT COUNT(*) FROM "{self._schema}"."{self._table_name}"'
        result = self._conn.raw_sql(query).fetchone()  # type: ignore[union-attr]
        return result[0] if result else 0

    def column_count(self) -> int:
        """Return the number of columns in the table."""
        return len(self.columns())

    def _fetch_column_descriptions(self) -> dict[str, str]:
        """Fetch column descriptions from pg_catalog."""
        try:
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
        except Exception:
            return {}

    def description(self) -> str | None:
        """Return the table description from pg_catalog."""
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


class RedshiftSSHTunnelConfig(BaseModel):
    """SSH tunnel configuration for Redshift connection."""

    ssh_host: str = Field(description="SSH host")
    ssh_port: int = Field(default=22, description="SSH port")
    ssh_username: str = Field(description="SSH username")
    ssh_private_key_path: str = Field(description="Path to SSH private key file")
    ssh_private_key_passphrase: str | None = Field(default=None, description="SSH private key passphrase (optional)")


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
    ssh_tunnel: RedshiftSSHTunnelConfig | None = Field(default=None, description="SSH tunnel configuration (optional)")

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

        use_ssh = ask_confirm("Use SSH tunnel?", default=False)
        ssh_tunnel = None

        if use_ssh:
            ssh_host = ask_text("SSH host:", required_field=True)
            ssh_port_str = ask_text("SSH port:", default="22") or "22"

            if not ssh_port_str.isdigit():
                raise InitError("SSH port must be a valid integer.")

            ssh_username = ask_text("SSH username:", required_field=True)
            ssh_private_key_path = ask_text("Path to SSH private key:", required_field=True)
            ssh_private_key_passphrase = ask_text("SSH private key passphrase (optional):", password=True)

            ssh_tunnel = RedshiftSSHTunnelConfig(
                ssh_host=ssh_host or "",
                ssh_port=int(ssh_port_str),
                ssh_username=ssh_username or "",
                ssh_private_key_path=ssh_private_key_path or "",
                ssh_private_key_passphrase=ssh_private_key_passphrase or None,
            )

        return RedshiftConfig(
            name=name,
            host=host or "",
            port=int(port_str),
            database=database or "",
            user=user or "",
            password=password or "",
            schema_name=schema_name,
            sslmode=sslmode,
            ssh_tunnel=ssh_tunnel,
        )

    def connect(self) -> BaseBackend:
        """Create an Ibis Redshift connection."""

        # Determine connection host and port
        connect_host = self.host
        connect_port = self.port

        # Set up SSH tunnel if configured
        if self.ssh_tunnel:
            ssh_pkey_path = Path(self.ssh_tunnel.ssh_private_key_path).expanduser()

            tunnel = SSHTunnelForwarder(
                (self.ssh_tunnel.ssh_host, self.ssh_tunnel.ssh_port),
                ssh_username=self.ssh_tunnel.ssh_username,
                ssh_pkey=str(ssh_pkey_path),
                ssh_private_key_password=self.ssh_tunnel.ssh_private_key_passphrase,
                remote_bind_address=(self.host, self.port),
                local_bind_address=("127.0.0.1", 0),  # let the OS pick an random free port
            )
            tunnel.start()

            # Use tunnel's local bind address
            connect_host = "127.0.0.1"
            connect_port = tunnel.local_bind_port

        kwargs: dict = {
            "host": connect_host,
            "port": connect_port,
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

    def get_schemas(self, conn: BaseBackend) -> list[str]:
        if self.schema_name:
            return [self.schema_name]
        list_databases = getattr(conn, "list_databases", None)
        schemas = list_databases() if list_databases else []
        return schemas + ["public"]

    def create_context(self, conn: BaseBackend, schema: str, table_name: str) -> RedshiftDatabaseContext:
        """Create a Redshift-specific database context that avoids pg_enum queries."""
        return RedshiftDatabaseContext(conn, schema, table_name)

    def check_connection(self) -> tuple[bool, str]:
        """Test connectivity to Redshift."""
        conn = None
        try:
            conn = self.connect()

            if self.schema_name:
                tables = conn.list_tables(database=self.schema_name)
                return True, f"Connected successfully ({len(tables)} tables found)"

            if self.database:
                if list_databases := getattr(conn, "list_databases", None):
                    schemas = list_databases() + ["public"]
                else:
                    schemas = ["public"]

                tables = []
                for schema in schemas:
                    tables.extend(conn.list_tables(database=schema))
                return True, f"Connected successfully ({len(tables)} tables found)"

            return True, "Connected successfully"
        except Exception as e:
            return False, str(e)
        finally:
            if conn is not None:
                conn.disconnect()
