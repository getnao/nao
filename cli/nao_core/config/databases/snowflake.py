from typing import Literal

import ibis
from ibis import BaseBackend
from pydantic import Field

from .base import DatabaseConfig


class SnowflakeConfig(DatabaseConfig):
    """Snowflake-specific configuration."""

    type: Literal["snowflake"] = "snowflake"
    user: str = Field(description="Snowflake username")
    account_id: str = Field(description="Snowflake account identifier (e.g., 'xy12345.us-east-1')")
    password: str = Field(description="Snowflake password")
    database: str = Field(description="Default Snowflake database")
    schema: str = Field(description="Default Snowflake schema")
    warehouse: str | None = Field(default=None, description="Snowflake warehouse to use")
    private_key_path: str | None = Field(
        default=None,
        description="Path to private key file for key-pair authentication",
    )

    key_pair_auth: bool = Field(
        default=False, description="Use key-pair authentication instead of password",
    )
    sso: bool = Field(default=False, description="Use Single Sign-On (SSO) for authentication")

    def connect(self) -> BaseBackend:
        """Create an Ibis Snowflake connection."""
        kwargs: dict = {"user": self.user}
        kwargs["password"] = self.password
        kwargs["account_id"] = self.account_id
        kwargs["database"] = self.database
        kwargs["schema"] = self.schema

        if self.key_pair_auth:
            with open(self.private_key_path, "rb") as key_file:
                kwargs["private_key"] = key_file.read()
            kwargs["warehouse"] = self.warehouse

        if self.sso:
            kwargs["authenticator"] = "externalbrowser"

        return ibis.snowflake.connect(**kwargs)
