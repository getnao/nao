from __future__ import annotations

from typing import TYPE_CHECKING, Literal
from urllib.parse import quote

from pydantic import Field

from nao_core.ui import ask_text

if TYPE_CHECKING:
    from ibis import BaseBackend

from .base import DatabaseConfig
from .duckdb import DuckDBDatabaseContext


def motherduck_database_path(database: str | None = None, token: str | None = None) -> str:
    """Build a MotherDuck connection path (`md:` / `md:db` with optional token query)."""
    db_name = (database or "").strip()
    path = f"md:{db_name}" if db_name else "md:"
    token_value = (token or "").strip()
    if token_value:
        separator = "&" if "?" in path else "?"
        path = f"{path}{separator}motherduck_token={quote(token_value, safe='')}"
    return path


class MotherDuckConfig(DatabaseConfig):
    """MotherDuck configuration (DuckDB-compatible cloud backend)."""

    type: Literal["motherduck"] = "motherduck"
    database: str | None = Field(
        default=None,
        description="MotherDuck database name (optional; connects to the default account database when empty)",
    )
    token: str | None = Field(
        default=None,
        description=(
            "MotherDuck access token. Prefer `{{ env('MOTHERDUCK_TOKEN') }}` in nao_config.yaml. "
            "When omitted, DuckDB also reads the MOTHERDUCK_TOKEN / motherduck_token environment variable."
        ),
    )

    @classmethod
    def promptConfig(cls) -> "MotherDuckConfig":
        """Interactively prompt the user for MotherDuck configuration."""
        name = ask_text("Connection name:", default="motherduck") or "motherduck"
        database = ask_text("Database name (optional, leave empty for default):") or None
        token = (
            ask_text(
                "MotherDuck token (leave empty to use MOTHERDUCK_TOKEN env var):",
                password=True,
            )
            or None
        )

        return MotherDuckConfig(name=name, database=database, token=token)

    def connection_path(self) -> str:
        """Return the DuckDB MotherDuck path used for connections."""
        return motherduck_database_path(self.database, self.token)

    def connect(self) -> BaseBackend:
        """Create an Ibis DuckDB connection to MotherDuck."""
        from nao_core.deps import require_database_backend

        # MotherDuck is served through the DuckDB engine / ibis duckdb backend.
        require_database_backend("duckdb", extra="duckdb", database_type="motherduck")
        import ibis

        # Keep external access enabled — MotherDuck is a remote service.
        # Do not apply the local DuckDB lockdown (enable_external_access=false).
        return ibis.duckdb.connect(database=self.connection_path(), read_only=False)

    def get_database_name(self) -> str:
        """Get the database name for MotherDuck."""
        if self.database and self.database.strip():
            return self.database.strip()
        return "motherduck"

    def check_connection(self) -> tuple[bool, str]:
        """Test connectivity to MotherDuck."""
        conn = None
        try:
            conn = self.connect()
            tables = conn.list_tables()
            return True, f"Connected successfully ({len(tables)} tables found)"
        except Exception as e:
            error_msg = str(e)
            empty_creds = self._get_empty_credentials()
            if empty_creds and any(
                keyword in error_msg.lower()
                for keyword in ("auth", "token", "credentials", "forbidden", "401", "403", "permission")
            ):
                creds_list = ", ".join(f"'{c}'" for c in empty_creds)
                return False, f"{error_msg} (check if environment variables for {creds_list} are set and non-empty)"
            return False, error_msg
        finally:
            if conn is not None:
                conn.disconnect()

    def create_context(self, conn: BaseBackend, schema: str, table_name: str) -> DuckDBDatabaseContext:
        return DuckDBDatabaseContext(conn, schema, table_name)
