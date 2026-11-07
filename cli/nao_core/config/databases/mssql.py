from __future__ import annotations

import platform
from typing import TYPE_CHECKING, Any, Literal

from pydantic import Field, model_validator

from nao_core.config.exceptions import InitError
from nao_core.ui import ask_select, ask_text

if TYPE_CHECKING:
    from ibis import BaseBackend

from .base import DatabaseConfig
from .context import DatabaseContext
from .fabric import FabricAuthMode, FabricConfig, _detect_fabric_driver

MssqlAuthMode = FabricAuthMode

_AUTH_MODE_CHOICES = {
    "SQL username/password": MssqlAuthMode.SQL_PASSWORD,
    "Entra ID Service Principal (Azure SQL)": MssqlAuthMode.AZURE_SERVICE_PRINCIPAL,
    "Entra ID via Azure CLI (az login)": MssqlAuthMode.AZURE_CLI,
    "Entra ID Interactive (browser)": MssqlAuthMode.AZURE_INTERACTIVE,
}


def _detect_odbc_driver() -> str:
    """Pick the best available ODBC driver for the current platform."""
    if platform.system() == "Windows":
        # Prefer the newest Microsoft ODBC driver available
        import pyodbc

        preferred = [
            "ODBC Driver 18 for SQL Server",
            "ODBC Driver 17 for SQL Server",
            "SQL Server",
        ]
        installed = {d for d in pyodbc.drivers()}
        for driver in preferred:
            if driver in installed:
                return driver

    return "FreeTDS"


MSSQL_SYSTEM_SCHEMAS = frozenset(
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


class MssqlDatabaseContext(DatabaseContext):
    def _quote(self, name: str) -> str:
        return f"[{name.replace(']', ']]')}]"

    def _cast_float(self, expr: str) -> str:
        return f"CAST({expr} AS FLOAT)"

    def _stddev(self, expr: str) -> str:
        return f"STDEVP({expr})"

    def _distinct_count_sql(self, col_sql: str) -> str:
        table_sql = f"{self._quote(self._schema)}.{self._quote(self._table_name)}"
        partition_filter = self._partition_filter()
        where_clause = f"WHERE {partition_filter}" if partition_filter else ""
        return f"(SELECT COUNT(DISTINCT {col_sql}) FROM {table_sql} {where_clause})"

    def _build_top_values_query(self, col: dict) -> str:
        col_sql = self._quote(col["name"])
        table_sql = f"{self._quote(self._schema)}.{self._quote(self._table_name)}"
        partition_filter = self._partition_filter()
        where_clause = f"WHERE {partition_filter}" if partition_filter else ""
        return f"""
            SELECT TOP 10 {col_sql} AS value, COUNT(*) AS cnt
            FROM {table_sql}
            {where_clause}
            GROUP BY {col_sql}
            ORDER BY cnt DESC, {col_sql} ASC
        """.strip()


class MssqlConfig(DatabaseConfig):
    """Microsoft SQL Server / Azure SQL Database configuration."""

    type: Literal["mssql"] = "mssql"
    host: str = Field(description="MSSQL host (e.g., 'myserver.database.windows.net' for Azure SQL)")
    port: int = Field(default=1433, description="MSSQL port")
    database: str = Field(description="Database name")
    auth_mode: MssqlAuthMode = Field(
        default=MssqlAuthMode.SQL_PASSWORD,
        description="Authentication method: 'sql_password', 'azure_service_principal', 'azure_cli', or "
        "'azure_interactive' (Entra ID modes require the Microsoft ODBC Driver 17/18 for SQL Server)",
    )
    user: str | None = Field(default=None, description="Username (sql_password auth)")
    password: str | None = Field(default=None, description="Password (sql_password auth)")
    client_id: str | None = Field(default=None, description="Entra ID application (client) ID")
    client_secret: str | None = Field(default=None, description="Entra ID client secret")
    tenant_id: str | None = Field(default=None, description="Entra ID tenant ID (optional)")
    driver: str = Field(
        default_factory=_detect_odbc_driver,
        description="ODBC driver (FreeTDS on Mac/Linux, ODBC Driver 18 for SQL Server on Windows or with Entra ID)",
    )
    schema_name: str | None = Field(default=None, description="Default schema (optional, uses 'dbo' if not set)")

    @model_validator(mode="before")
    @classmethod
    def default_entra_id_driver(cls, data: Any) -> Any:
        """FreeTDS cannot authenticate with Entra ID, so Entra ID modes default to the Microsoft driver."""
        if isinstance(data, dict) and not data.get("driver"):
            auth_mode = data.get("auth_mode") or MssqlAuthMode.SQL_PASSWORD
            if auth_mode != MssqlAuthMode.SQL_PASSWORD:
                return {**data, "driver": _detect_fabric_driver()}
        return data

    @model_validator(mode="after")
    def validate_credentials(self) -> "MssqlConfig":
        if self.auth_mode == MssqlAuthMode.SQL_PASSWORD:
            if self.user is None or self.password is None:
                raise ValueError("user and password are required for sql_password auth mode")
        elif self.auth_mode == MssqlAuthMode.AZURE_SERVICE_PRINCIPAL:
            if not self.client_id or not self.client_secret:
                raise ValueError("client_id and client_secret are required for azure_service_principal auth mode")
        return self

    @classmethod
    def promptConfig(cls) -> "MssqlConfig":
        """Interactively prompt the user for MSSQL configuration."""
        name = ask_text("Connection name:", default="mssql-prod") or "mssql-prod"
        host = ask_text("Host (e.g., localhost or myserver.database.windows.net):", default="localhost") or "localhost"
        port_str = ask_text("Port:", default="1433") or "1433"

        if not port_str.isdigit():
            raise InitError("Port must be a valid integer.")

        database = ask_text("Database name:", required_field=True)
        auth_mode = _AUTH_MODE_CHOICES[ask_select("Authentication method:", choices=list(_AUTH_MODE_CHOICES))]

        user = password = client_id = client_secret = tenant_id = None
        if auth_mode == MssqlAuthMode.SQL_PASSWORD:
            user = ask_text("Username:", required_field=True)
            password = ask_text("Password:", password=True) or ""
        elif auth_mode == MssqlAuthMode.AZURE_SERVICE_PRINCIPAL:
            client_id = ask_text("Entra ID Client ID:", required_field=True)
            client_secret = ask_text("Entra ID Client Secret:", password=True, required_field=True)
            tenant_id = ask_text("Tenant ID (optional):")
            if not client_id or not client_secret:
                raise InitError("Client ID and Client Secret are required for Service Principal authentication.")

        detected_driver = _detect_odbc_driver() if auth_mode == MssqlAuthMode.SQL_PASSWORD else _detect_fabric_driver()
        driver = ask_text("ODBC driver:", default=detected_driver) or detected_driver
        schema_name = ask_text("Default schema (uses 'dbo' if empty):")

        return MssqlConfig(
            name=name,
            host=host,
            port=int(port_str),
            database=database,  # type: ignore
            auth_mode=auth_mode,
            user=user,
            password=password,
            client_id=client_id,
            client_secret=client_secret,
            tenant_id=tenant_id,
            driver=driver,
            schema_name=schema_name,
        )

    def connect(self) -> BaseBackend:
        """Create an Ibis MSSQL connection."""
        from nao_core.deps import require_database_backend, require_dependency

        require_database_backend("mssql")

        if self.auth_mode != MssqlAuthMode.SQL_PASSWORD:
            if self.auth_mode in (MssqlAuthMode.AZURE_CLI, MssqlAuthMode.AZURE_INTERACTIVE):
                require_dependency("azure.identity", "mssql", "for Entra ID authentication")
            return self._to_entra_id_config().connect()

        import ibis

        return ibis.mssql.connect(
            host=self.host,
            port=self.port,
            database=self.database,
            user=self.user,
            password=self.password,
            driver=self.driver,
        )

    def _to_entra_id_config(self) -> FabricConfig:
        """Azure SQL runs the same engine and Entra ID token flow as Fabric, so its connection logic is reused."""
        return FabricConfig(
            name=self.name,
            host=self.host,
            port=self.port,
            database=self.database,
            auth_mode=self.auth_mode,
            client_id=self.client_id,
            client_secret=self.client_secret,
            tenant_id=self.tenant_id,
            driver=self.driver,
        )

    def get_database_name(self) -> str:
        """Get the database name for MSSQL."""
        return self.database

    def get_schemas(self, conn: BaseBackend) -> list[str]:
        if self.schema_name:
            return [self.schema_name]
        list_databases = getattr(conn, "list_databases", None)
        if list_databases:
            schemas = list_databases()
            return [s for s in schemas if s not in MSSQL_SYSTEM_SCHEMAS]
        return []

    def create_context(self, conn: BaseBackend, schema: str, table_name: str) -> MssqlDatabaseContext:
        return MssqlDatabaseContext(conn, schema, table_name)

    def check_connection(self) -> tuple[bool, str]:
        """Test connectivity to MSSQL."""
        conn = None
        try:
            conn = self.connect()
            if self.schema_name:
                tables = conn.list_tables(database=self.schema_name)
                return True, f"Connected successfully ({len(tables)} tables found)"
            list_databases = getattr(conn, "list_databases", None)
            if list_databases:
                schemas = list_databases()
                schemas = [s for s in schemas if s not in MSSQL_SYSTEM_SCHEMAS]
                return True, f"Connected successfully ({len(schemas)} schemas found)"
            return True, "Connected successfully"
        except Exception as e:
            return False, str(e)
        finally:
            if conn is not None:
                conn.disconnect()
