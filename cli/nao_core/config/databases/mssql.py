import platform
from typing import Literal

import ibis
from ibis import BaseBackend
from pydantic import Field

from nao_core.config.exceptions import InitError
from nao_core.ui import ask_text

from .base import DatabaseConfig
from .context import DatabaseContext


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
    """Microsoft SQL Server configuration."""

    type: Literal["mssql"] = "mssql"
    host: str = Field(description="MSSQL host")
    port: int = Field(default=1433, description="MSSQL port")
    database: str = Field(description="Database name")
    user: str = Field(description="Username")
    password: str = Field(description="Password")
    driver: str = Field(
        default_factory=_detect_odbc_driver,
        description="ODBC driver (FreeTDS on Mac/Linux, ODBC Driver 18 for SQL Server on Windows)",
    )
    schema_name: str | None = Field(default=None, description="Default schema (optional, uses 'dbo' if not set)")

    @classmethod
    def promptConfig(cls) -> "MssqlConfig":
        """Interactively prompt the user for MSSQL configuration."""
        name = ask_text("Connection name:", default="mssql-prod") or "mssql-prod"
        host = ask_text("Host:", default="localhost") or "localhost"
        port_str = ask_text("Port:", default="1433") or "1433"

        if not port_str.isdigit():
            raise InitError("Port must be a valid integer.")

        database = ask_text("Database name:", required_field=True)
        user = ask_text("Username:", required_field=True)
        password = ask_text("Password:", password=True) or ""
        detected_driver = _detect_odbc_driver()
        driver = ask_text("ODBC driver:", default=detected_driver) or detected_driver
        schema_name = ask_text("Default schema (uses 'dbo' if empty):")

        return MssqlConfig(
            name=name,
            host=host,
            port=int(port_str),
            database=database,  # type: ignore
            user=user,  # type: ignore
            password=password,
            driver=driver,
            schema_name=schema_name,
        )

    def connect(self) -> BaseBackend:
        """Create an Ibis MSSQL connection."""
        return ibis.mssql.connect(
            host=self.host,
            port=self.port,
            database=self.database,
            user=self.user,
            password=self.password,
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
