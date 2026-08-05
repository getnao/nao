from __future__ import annotations

import os
from typing import TYPE_CHECKING, Literal

from pydantic import Field

from nao_core.ui import ask_text

if TYPE_CHECKING:
    from ibis import BaseBackend

from .base import DatabaseConfig
from .duckdb import DuckDBDatabaseContext


class MotherDuckConfig(DatabaseConfig):
    """MotherDuck-specific configuration.

    MotherDuck is DuckDB's managed cloud. It speaks the DuckDB SQL dialect and
    connects through the DuckDB engine using an ``md:`` connection string, so it
    reuses DuckDB's context rendering.
    """

    type: Literal["motherduck"] = "motherduck"
    database: str | None = Field(
        default=None,
        description="MotherDuck database to connect to. Leave empty to use your default database.",
    )
    token: str | None = Field(
        default=None,
        description=(
            "MotherDuck access token. If omitted, the `motherduck_token` environment variable is used. "
            "Prefer a secret reference such as {{ env('motherduck_token') }} over an inline value."
        ),
    )
    read_only: bool = Field(
        default=False,
        description="Open the MotherDuck connection in read-only mode.",
    )

    @classmethod
    def promptConfig(cls) -> "MotherDuckConfig":
        """Interactively prompt the user for MotherDuck configuration."""
        name = ask_text("Connection name:", default="motherduck") or "motherduck"
        database = ask_text("MotherDuck database (leave empty for your default):") or None
        token = (
            ask_text(
                "MotherDuck access token (leave empty to use the motherduck_token env var):",
                password=True,
            )
            or None
        )

        return MotherDuckConfig(name=name, database=database, token=token)

    def connect(self) -> BaseBackend:
        """Create an Ibis DuckDB connection to MotherDuck."""
        from nao_core.deps import require_database_backend

        require_database_backend("duckdb")
        import ibis

        if self.token:
            os.environ["motherduck_token"] = self.token

        database = f"md:{self.database}" if self.database else "md:"
        return ibis.duckdb.connect(database=database, read_only=self.read_only)

    def get_database_name(self) -> str:
        """Get the database name for MotherDuck."""
        return self.database or "my_db"

    def check_connection(self) -> tuple[bool, str]:
        """Test connectivity to MotherDuck."""
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
