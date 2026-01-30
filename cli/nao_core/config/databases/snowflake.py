from typing import Literal

import ibis
from cryptography.hazmat.backends import default_backend
from cryptography.hazmat.primitives import serialization
from ibis import BaseBackend
from pydantic import Field

from nao_core.ui import ask_confirm, ask_text

from .base import DatabaseConfig


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
        name = ask_text("Connection name:", default="snowflake-prod") or "snowflake-prod"
        username = ask_text("Snowflake username:", required_field=True)
        account_id = ask_text("Account identifier (e.g., xy12345.us-east-1):", required_field=True)
        database = ask_text("Snowflake database:", required_field=True)
        warehouse = ask_text("Warehouse (optional):")
        schema = ask_text("Default schema (optional):")

        key_pair_auth = ask_confirm("Use key-pair authentication?", default=False)

        password = None
        private_key_path = None
        passphrase = None

        if key_pair_auth:
            private_key_path = ask_text("Path to private key file:", required_field=True)
            passphrase = ask_text("Private key passphrase (optional):", password=True)
        else:
            password = ask_text("Snowflake password:", password=True, required_field=True)

        return SnowflakeConfig(
            name=name,
            username=username,  # type: ignore
            password=password,
            account_id=account_id,  # type: ignore
            database=database,  # type: ignore
            warehouse=warehouse,
            schema_name=schema,
            private_key_path=private_key_path,
            passphrase=passphrase,
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
