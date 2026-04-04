from __future__ import annotations

from pathlib import Path
from typing import TYPE_CHECKING, Literal

from pydantic import Field

from nao_core.ui import ask_text

if TYPE_CHECKING:
    from ibis import BaseBackend

from .base import DatabaseConfig
from .context import DatabaseContext


class DuckDBDatabaseContext(DatabaseContext):
    def _cast_complex_to_string(self, col_sql: str) -> str:
        return f"CAST({col_sql} AS VARCHAR)"


class DuckDBConfig(DatabaseConfig):
    """DuckDB-specific configuration."""

    type: Literal["duckdb"] = "duckdb"
    path: str = Field(description="Path to the DuckDB database file", default=":memory:")

    @classmethod
    def promptConfig(cls) -> "DuckDBConfig":
        """Interactively prompt the user for DuckDB configuration."""
        name = ask_text("Connection name:", default="duckdb-local") or "duckdb-local"
        path = ask_text("Path to database file:", default=":memory:") or ":memory:"

        return DuckDBConfig(name=name, path=path)

    def connect(self) -> BaseBackend:
        """Create an Ibis DuckDB connection."""
        from nao_core.deps import require_database_backend

        require_database_backend("duckdb")
        import ibis

        return ibis.duckdb.connect(
            database=self.path,
            read_only=False if self.path == ":memory:" else True,
        )

    def get_database_name(self) -> str:
        """Get the database name for DuckDB."""
        if self.path == ":memory:":
            return "memory"
        return Path(self.path).stem

    def check_connection(self) -> tuple[bool, str]:
        """Test connectivity to DuckDB."""
        conn = None
        try:
            conn = self.connect()
            tables = conn.list_tables()
            return True, f"Connected successfully ({len(tables)} tables found)"
        except Exception as e:
            return False, str(e)
        finally:
            if conn is not None:
                conn.disconnect()

    def create_context(self, conn: BaseBackend, schema: str, table_name: str) -> DuckDBDatabaseContext:
        return DuckDBDatabaseContext(conn, schema, table_name)
