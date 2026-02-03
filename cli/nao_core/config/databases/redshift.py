from pathlib import Path
from typing import Literal

import ibis
from ibis import BaseBackend
from pydantic import BaseModel, Field
from sshtunnel import SSHTunnelForwarder

from nao_core.config.exceptions import InitError
from nao_core.ui import ask_confirm, ask_text

from .base import DatabaseConfig


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
