from typing import Literal

import ibis
from cryptography.hazmat.backends import default_backend
from cryptography.hazmat.primitives import serialization
from ibis import BaseBackend
from pydantic import Field
from rich.prompt import Confirm, Prompt

from nao_core.config.exceptions import InitError

from .base import DatabaseConfig, console


class SnowflakeConfig(DatabaseConfig):
    """Snowflake-specific configuration."""

    type: Literal["snowflake"] = "snowflake"
    username: str = Field(description="Snowflake username")
    account_id: str = Field(description="Snowflake account identifier (e.g., 'xy12345.us-east-1')")
    password: str | None = Field(default=None, description="Snowflake password")
    database: str = Field(description="Snowflake database")
    schema_name: str | None = Field(
        default=None,
        validation_alias="schema",
        serialization_alias="schema",
        description="Snowflake schema (optional)",
    )
    warehouse: str | None = Field(default=None, description="Snowflake warehouse to use (optional)")
    private_key_path: str | None = Field(
        default=None,
        description="Path to private key file for key-pair authentication",
    )
    passphrase: str | None = Field(
        default=None,
        description="Passphrase for the private key if it is encrypted",
    )

    @classmethod
    def promptConfig(cls) -> "SnowflakeConfig":
        """Interactively prompt the user for Snowflake configuration."""
        console.print("\n[bold cyan]Snowflake Configuration[/bold cyan]\n")

        name = Prompt.ask("[bold]Connection name[/bold]", default="snowflake-prod")

        username = Prompt.ask("[bold]Snowflake username[/bold]")
        if not username:
            raise InitError("Snowflake username cannot be empty.")

        account_id = Prompt.ask("[bold]Snowflake account identifier[/bold]")
        if not account_id:
            raise InitError("Snowflake account identifier cannot be empty.")

        database = Prompt.ask("[bold]Snowflake database[/bold]")
        if not database:
            raise InitError("Snowflake database cannot be empty.")

        warehouse = Prompt.ask(
            "[bold]Snowflake warehouse[/bold] [dim](optional, press Enter to skip)[/dim]", default=None
        )

        schema = Prompt.ask("[bold]Default schema[/bold] [dim](optional, press Enter to skip)[/dim]", default=None)

        key_pair_auth = Confirm.ask("[bold]Use key-pair authentication for authentication?[/bold]", default=False)

        if key_pair_auth:
            private_key_path = Prompt.ask("[bold]Path to private key file[/bold]")
            if not private_key_path:
                raise InitError("Path to private key file cannot be empty.")
            passphrase = Prompt.ask(
                "[bold]Passphrase for the private key[/bold] [dim](optional, press Enter to skip)[/dim]",
                default=None,
                password=True,
            )
        else:
            password = Prompt.ask("[bold]Snowflake password[/bold]", password=True)
            if not password:
                raise InitError("Snowflake password cannot be empty.")

        return SnowflakeConfig(
            name=name,
            username=username,
            password=password if not key_pair_auth else None,
            account_id=account_id,
            database=database,
            warehouse=warehouse,
            schema_name=schema,
            private_key_path=private_key_path if key_pair_auth else None,
            passphrase=passphrase if key_pair_auth else None,
        )

    def connect(self) -> BaseBackend:
        """Create an Ibis Snowflake connection."""
        kwargs: dict = {"user": self.username}
        kwargs["account"] = self.account_id

        if self.database and self.schema_name:
            kwargs["database"] = f"{self.database}/{self.schema_name}"
        elif self.database:
            kwargs["database"] = self.database

        if self.warehouse:
            kwargs["warehouse"] = self.warehouse

        if self.private_key_path:
            with open(self.private_key_path, "rb") as key_file:
                private_key = serialization.load_pem_private_key(
                    key_file.read(),
                    password=self.passphrase.encode() if self.passphrase else None,
                    backend=default_backend(),
                )
                # Convert to DER format which Snowflake expects
                kwargs["private_key"] = private_key.private_bytes(
                    encoding=serialization.Encoding.DER,
                    format=serialization.PrivateFormat.PKCS8,
                    encryption_algorithm=serialization.NoEncryption(),
                )
        kwargs["password"] = self.password

        return ibis.snowflake.connect(**kwargs)

    def get_database_name(self) -> str:
        """Get the database name for Snowflake."""

        return self.database
