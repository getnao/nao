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

    @staticmethod
    def _is_motherduck_path(path: str) -> bool:
        """True when *path* targets MotherDuck (`md:` / `motherduck:`)."""
        normalized = path.strip().lower()
        return normalized.startswith("md:") or normalized.startswith("motherduck:")

    def connect(self) -> BaseBackend:
        """Create an Ibis DuckDB connection with external file/network access disabled.

        MotherDuck paths (`md:` / `motherduck:`) keep external access enabled so the
        remote service can be reached. Prefer ``type: motherduck`` for new configs.
        """
        from nao_core.deps import require_database_backend

        require_database_backend("duckdb")
        import ibis

        is_motherduck = self._is_motherduck_path(self.path)
        # MotherDuck is remote and needs write-capable sessions; local files stay read-only.
        read_only = False if (self.path == ":memory:" or is_motherduck) else True
        conn = ibis.duckdb.connect(
            database=self.path,
            read_only=read_only,
        )
        if not is_motherduck:
            conn.raw_sql("SET enable_external_access = false")
            conn.raw_sql("SET lock_configuration = true")
        return conn

    def get_database_name(self) -> str:
        """Get the database name for DuckDB."""
        if self.path == ":memory:":
            return "memory"
        if self._is_motherduck_path(self.path):
            # md:my_db or md:my_db?motherduck_token=...
            remainder = self.path.split(":", 1)[1]
            db_part = remainder.split("?", 1)[0].strip()
            return db_part or "motherduck"
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
