import os
from typing import Literal

import ibis
from cryptography.hazmat.backends import default_backend
from cryptography.hazmat.primitives import serialization
from ibis import BaseBackend
from pydantic import Field

from nao_core.config.exceptions import InitError
from nao_core.ui import UI, ask_confirm, ask_text

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
    authenticator: Literal["externalbrowser", "username_password_mfa", "jwt_token", "oauth"] | None = Field(
        default=None,
        description="Authentication method (e.g., 'externalbrowser' for SSO)",
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

        use_sso = ask_confirm("Use SSO (external browser) for authentication?", default=False)
        key_pair_auth = False if use_sso else ask_confirm("Use key-pair authentication?", default=False)
        authenticator = "externalbrowser" if use_sso else None

        if key_pair_auth:
            private_key_path = ask_text("Path to private key file:", required_field=True)
            if not private_key_path or not os.path.isfile(private_key_path):
                raise InitError(f"Private key file not found: {private_key_path}")
            passphrase = ask_text("Private key passphrase (optional):", password=True)
            password = None
        else:
            password = None if use_sso else ask_text("Snowflake password:", password=True, required_field=True)
            if not use_sso and not password:
                raise InitError("Snowflake password cannot be empty.")
            private_key_path = None
            passphrase = None

        return SnowflakeConfig(
            name=name,
            username=username or "",
            password=password,
            account_id=account_id or "",
            database=database or "",
            warehouse=warehouse,
            schema_name=schema,
            private_key_path=private_key_path,
            passphrase=passphrase,
            authenticator=authenticator,
        )

    def connect(self) -> BaseBackend:
        """Create an Ibis Snowflake connection."""
        kwargs: dict = {"user": self.username}
        kwargs["account"] = self.account_id

        # Always connect to just the database, not database/schema
        # The sync provider will handle schema filtering via list_tables(database=schema)
        if self.database:
            kwargs["database"] = self.database

        if self.warehouse:
            kwargs["warehouse"] = self.warehouse

        # Add authenticator if using SSO (external browser)
        if self.authenticator:
            kwargs["authenticator"] = self.authenticator
            UI.info(f"[yellow]Using authenticator: {self.authenticator}[/yellow]")

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
        elif self.password:
            kwargs["password"] = self.password

        return ibis.snowflake.connect(**kwargs, create_object_udfs=False)

    def get_database_name(self) -> str:
        """Get the database name for Snowflake."""
        return self.database

    def matches_pattern(self, schema: str, table: str) -> bool:
        """Check if a schema.table matches the include/exclude patterns.

        Snowflake identifier matching is case-insensitive.
        """
        from fnmatch import fnmatch

        full_name = f"{schema}.{table}"
        full_name_lower = full_name.lower()

        # If include patterns exist, table must match at least one
        if self.include:
            included = any(fnmatch(full_name_lower, pattern.lower()) for pattern in self.include)
            if not included:
                return False

        # If exclude patterns exist, table must not match any
        if self.exclude:
            excluded = any(fnmatch(full_name_lower, pattern.lower()) for pattern in self.exclude)
            if excluded:
                return False

        return True

    def _schema_matches(self, schema: str) -> bool:
        """Check if a schema could have any matching tables based on include/exclude patterns."""
        from fnmatch import fnmatch

        schema_lower = schema.lower()

        if self.include:
            included = any(fnmatch(schema_lower, p.split(".")[0].lower()) for p in self.include)
            if not included:
                return False

        if self.exclude:
            excluded = any(fnmatch(schema_lower, p.split(".")[0].lower()) for p in self.exclude if p.endswith(".*"))
            if excluded:
                return False

        return True

    def get_schemas(self, conn: BaseBackend) -> list[str]:
        if self.schema_name:
            return [self.schema_name.upper()]
        list_databases = getattr(conn, "list_databases", None)
        schemas = list_databases() if list_databases else []
        schemas = [s for s in schemas if s != "INFORMATION_SCHEMA"]
        return [s for s in schemas if self._schema_matches(s)]

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
        """Test connectivity to Snowflake."""
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
