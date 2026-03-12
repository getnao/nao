from __future__ import annotations

import struct
from enum import Enum
from typing import TYPE_CHECKING, Literal

if TYPE_CHECKING:
    from azure.identity import AzureCliCredential, InteractiveBrowserCredential

from ibis import BaseBackend
from pydantic import Field, model_validator

from nao_core.config.exceptions import InitError
from nao_core.ui import UI, ask_select, ask_text

from .base import DatabaseConfig

# Internal schemas created by SQL Server / Fabric — never user data.
FABRIC_SYSTEM_SCHEMAS = frozenset(
    {
        "db_accessadmin",
        "db_backupoperator",
        "db_datareader",
        "db_datawriter",
        "db_ddladmin",
        "db_denydatareader",
        "db_denydatawriter",
        "db_owner",
        "db_securityadmin",
        "guest",
        "INFORMATION_SCHEMA",
        "sys",
    }
)

# ODBC pre-connection attribute key for injecting an Azure AD access token.
# Must be passed via attrs_before so it is set before the driver opens the session.
_SQL_COPT_SS_ACCESS_TOKEN = 1256


class FabricAuthMode(str, Enum):
    SQL_PASSWORD = "sql_password"  # Username + password
    AZURE_INTERACTIVE = "azure_interactive"  # Interactive browser login
    AZURE_CLI = "azure_cli"  # Token from `az login`
    AZURE_SERVICE_PRINCIPAL = "azure_service_principal"  # Client ID + secret


def _odbc_escape(value: str) -> str:
    # ODBC spec: values containing ; { } = must be wrapped in braces,
    # with any literal } doubled to }}.
    if any(c in value for c in ";{}="):
        return "{" + value.replace("}", "}}") + "}"
    return value


def _detect_fabric_driver() -> str:
    """Pick the best available Microsoft ODBC driver."""
    try:
        import pyodbc

        preferred = ["ODBC Driver 18 for SQL Server", "ODBC Driver 17 for SQL Server"]
        installed = set(pyodbc.drivers())
        for driver in preferred:
            if driver in installed:
                return driver
    except Exception:
        pass
    return "ODBC Driver 18 for SQL Server"


def _encode_access_token(token: str) -> bytes:
    """Encode a token as the ODBC driver expects: UTF-16-LE with a 4-byte little-endian length prefix."""
    token_bytes = token.encode("utf-16-le")
    return struct.pack(f"<I{len(token_bytes)}s", len(token_bytes), token_bytes)


class FabricConfig(DatabaseConfig):
    """Microsoft Fabric Data Warehouse / SQL Analytics Endpoint configuration."""

    type: Literal["fabric"] = "fabric"
    host: str = Field(description="Fabric SQL endpoint (e.g., 'abc123.datawarehouse.fabric.microsoft.com')")
    port: int = Field(default=1433, description="SQL port")
    database: str = Field(description="Warehouse or Lakehouse name")
    auth_mode: FabricAuthMode = Field(
        default=FabricAuthMode.SQL_PASSWORD,
        description="Authentication method: 'sql_password', 'azure_interactive', 'azure_cli', or 'azure_service_principal'",
    )

    # SQL auth
    user: str | None = Field(default=None, description="SQL username")
    password: str | None = Field(default=None, description="SQL password")

    # Service Principal
    client_id: str | None = Field(default=None, description="Azure AD application (client) ID")
    client_secret: str | None = Field(default=None, description="Azure AD client secret")
    tenant_id: str | None = Field(default=None, description="Azure AD tenant ID (optional)")

    schema_name: str | None = Field(default=None, description="Default schema (optional)")
    driver: str = Field(
        default_factory=_detect_fabric_driver,
        description="ODBC driver — must be 'ODBC Driver 17/18 for SQL Server' (not FreeTDS)",
    )

    @model_validator(mode="after")
    def validate_credentials(self) -> "FabricConfig":
        if self.auth_mode == FabricAuthMode.SQL_PASSWORD:
            if not self.user or not self.password:
                raise ValueError("user and password are required for sql_password auth mode")
        elif self.auth_mode == FabricAuthMode.AZURE_SERVICE_PRINCIPAL:
            if not self.client_id or not self.client_secret:
                raise ValueError("client_id and client_secret are required for azure_service_principal auth mode")
        return self

    @classmethod
    def promptConfig(cls) -> "FabricConfig":
        """Interactively prompt the user for Fabric configuration."""
        name = ask_text("Connection name:", default="fabric-prod") or "fabric-prod"
        host = ask_text(
            "Fabric SQL endpoint (e.g., abc123.datawarehouse.fabric.microsoft.com):",
            required_field=True,
        )
        database = ask_text("Warehouse / Lakehouse name:", required_field=True)
        schema_name = ask_text("Default schema (optional):")

        auth_choice = ask_select(
            "Authentication method:",
            choices=[
                "SQL username/password",
                "Azure Interactive (browser)",
                "Azure CLI (az login)",
                "Azure Service Principal",
            ],
        )

        user = password = client_id = client_secret = tenant_id = None

        if auth_choice == "Azure Interactive (browser)":
            auth_mode = FabricAuthMode.AZURE_INTERACTIVE
        elif auth_choice == "Azure CLI (az login)":
            auth_mode = FabricAuthMode.AZURE_CLI
        elif auth_choice == "Azure Service Principal":
            auth_mode = FabricAuthMode.AZURE_SERVICE_PRINCIPAL
            client_id = ask_text("Azure AD Client ID:", required_field=True)
            client_secret = ask_text("Azure AD Client Secret:", password=True, required_field=True)
            tenant_id = ask_text("Tenant ID (optional):")
            if not client_id or not client_secret:
                raise InitError("Client ID and Client Secret are required for Azure Service Principal authentication.")
        else:
            auth_mode = FabricAuthMode.SQL_PASSWORD
            user = ask_text("SQL username:", required_field=True)
            password = ask_text("SQL password:", password=True, required_field=True)
            if not user or not password:
                raise InitError("Username and password are required for SQL authentication.")

        detected_driver = _detect_fabric_driver()
        driver = ask_text("ODBC driver:", default=detected_driver) or detected_driver

        return FabricConfig(
            name=name,
            host=host,  # type: ignore
            database=database,  # type: ignore
            auth_mode=auth_mode,
            user=user,
            password=password,
            client_id=client_id,
            client_secret=client_secret,
            tenant_id=tenant_id,
            schema_name=schema_name,
            driver=driver,
        )

    def build_odbc_string(self) -> str:
        """Build the ODBC connection string for sql_password and azure_service_principal auth modes.

        azure_interactive and azure_cli do not embed credentials here — they obtain an Azure AD
        token externally and inject it via SQL_COPT_SS_ACCESS_TOKEN in _connect_via_aad_token_injection.
        """
        parts = self._base_odbc_parts()

        if self.auth_mode == FabricAuthMode.SQL_PASSWORD:
            if self.user is None or self.password is None:
                raise ValueError("user and password are required for sql_password auth mode")
            parts += [f"UID={_odbc_escape(self.user)}", f"PWD={_odbc_escape(self.password)}"]
        elif self.auth_mode == FabricAuthMode.AZURE_SERVICE_PRINCIPAL:
            if self.client_id is None or self.client_secret is None:
                raise ValueError("client_id and client_secret are required for azure_service_principal auth mode")
            uid = f"{self.client_id}@{self.tenant_id}" if self.tenant_id else self.client_id
            parts += [
                "Authentication=ActiveDirectoryServicePrincipal",
                f"UID={_odbc_escape(uid)}",
                f"PWD={_odbc_escape(self.client_secret)}",
            ]
        # azure_interactive and azure_cli use token injection — no credentials in the ODBC string.

        return ";".join(parts)

    def connect(self) -> BaseBackend:
        """Create an Ibis connection to Microsoft Fabric via ODBC.

        azure_cli and azure_interactive use token injection (see _connect_via_aad_token_injection).
        sql_password and azure_service_principal use a standard ODBC connection string.
        """
        if self.auth_mode == FabricAuthMode.AZURE_CLI:
            from azure.identity import AzureCliCredential

            return self._connect_via_aad_token_injection(
                AzureCliCredential(), "Azure CLI: fetching token from 'az login' credentials."
            )
        if self.auth_mode == FabricAuthMode.AZURE_INTERACTIVE:
            from azure.identity import InteractiveBrowserCredential

            # ActiveDirectoryInteractive in the ODBC driver doesn't open a browser on macOS.
            # Use InteractiveBrowserCredential from azure-identity instead, which handles
            # browser-based auth correctly cross-platform, then inject the token directly.
            return self._connect_via_aad_token_injection(
                InteractiveBrowserCredential(), "Azure Interactive: a browser window will open for authentication."
            )

        import pyodbc
        from ibis.backends.mssql import Backend as MSSQLBackend

        conn = pyodbc.connect(self.build_odbc_string())
        return MSSQLBackend.from_connection(conn)

    def _connect_via_aad_token_injection(
        self, credential: AzureCliCredential | InteractiveBrowserCredential, message: str
    ) -> BaseBackend:
        """Connect using an Azure AD token injected via SQL_COPT_SS_ACCESS_TOKEN.

        The token is obtained from the provided credential (AzureCliCredential for azure_cli,
        InteractiveBrowserCredential for azure_interactive), encoded as UTF-16-LE with a 4-byte
        little-endian length prefix, and passed via attrs_before so the ODBC driver
        receives it before opening the session.
        """
        UI.info(f"[yellow]{message}[/yellow]")

        token = credential.get_token("https://database.windows.net/.default")
        token_struct = _encode_access_token(token.token)

        import pyodbc
        from ibis.backends.mssql import Backend as MSSQLBackend

        conn = pyodbc.connect(";".join(self._base_odbc_parts()), attrs_before={_SQL_COPT_SS_ACCESS_TOKEN: token_struct})
        return MSSQLBackend.from_connection(conn)

    def _base_odbc_parts(self) -> list[str]:
        """Return the ODBC connection string parts shared across all auth modes."""
        return [
            f"Driver={{{self.driver}}}",
            f"Server={self.host},{self.port}",
            f"Database={_odbc_escape(self.database)}",
            "Encrypt=yes",
            "TrustServerCertificate=no",
        ]

    def get_database_name(self) -> str:
        return self.database

    def get_schemas(self, conn: BaseBackend) -> list[str]:
        if self.schema_name:
            return [self.schema_name]
        list_databases = getattr(conn, "list_databases", None)
        if list_databases:
            schemas = list_databases()
            return [s for s in schemas if s not in FABRIC_SYSTEM_SCHEMAS]
        return []

    def check_connection(self) -> tuple[bool, str]:
        """Test connectivity to Microsoft Fabric."""
        conn = None
        try:
            conn = self.connect()
            if self.schema_name:
                tables = conn.list_tables(database=self.schema_name)
                return True, f"Connected successfully ({len(tables)} tables found)"
            list_databases = getattr(conn, "list_databases", None)
            if list_databases:
                schemas = list_databases()
                schemas = [s for s in schemas if s not in FABRIC_SYSTEM_SCHEMAS]
                return True, f"Connected successfully ({len(schemas)} schemas found)"
            return True, "Connected successfully"
        except Exception as e:
            return False, str(e)
        finally:
            if conn is not None:
                conn.disconnect()
