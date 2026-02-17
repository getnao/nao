from pathlib import Path
from typing import Literal

import ibis
from ibis import BaseBackend
from pydantic import Field

from nao_core.ui import ask_text

from .base import DatabaseConfig


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
