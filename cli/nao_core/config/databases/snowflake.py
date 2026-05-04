from __future__ import annotations

import logging
import os
import re
from typing import TYPE_CHECKING, Any, Literal

from pydantic import Field

from nao_core.config.exceptions import InitError
from nao_core.ui import UI, ask_confirm, ask_text

if TYPE_CHECKING:
    from ibis import BaseBackend

from .base import DatabaseConfig
from .context import DatabaseContext

logger = logging.getLogger(__name__)


class SnowflakeDatabaseContext(DatabaseContext):
    """Snowflake context with clustering key and description discovery."""

    def partition_columns(self) -> list[str]:
        try:
            return _get_snowflake_clustering_columns(self._conn, self._schema, self._table_name)
        except Exception:
            logger.debug("Failed to fetch clustering keys for %s.%s", self._schema, self._table_name)
            return []

    def description(self) -> str | None:
        try:
            query = f"""
                SELECT COMMENT FROM INFORMATION_SCHEMA.TABLES
                WHERE TABLE_SCHEMA = '{self._schema}' AND TABLE_NAME = '{self._table_name}'
            """
            row = self._conn.raw_sql(query).fetchone()  # type: ignore[union-attr]
            if row and row[0]:
                return str(row[0]).strip() or None
        except Exception:
            pass
        return None

    def columns(self) -> list[dict[str, Any]]:
        cols = super().columns()
        try:
            col_descs = self._fetch_column_descriptions()
            for col in cols:
                if desc := col_descs.get(col["name"]):
                    col["description"] = desc
        except Exception:
            pass
        return cols

    def _fetch_column_descriptions(self) -> dict[str, str]:
        query = f"""
            SELECT COLUMN_NAME, COMMENT FROM INFORMATION_SCHEMA.COLUMNS
            WHERE TABLE_SCHEMA = '{self._schema}' AND TABLE_NAME = '{self._table_name}'
              AND COMMENT IS NOT NULL AND COMMENT != ''
        """
        rows = self._conn.raw_sql(query).fetchall()  # type: ignore[union-attr]
        return {row[0]: str(row[1]) for row in rows if row[1]}

    def _cast_float(self, expr: str) -> str:
        return f"{expr}::FLOAT"

    def _cast_complex_to_string(self, col_sql: str) -> str:
        return f"TO_JSON({col_sql})::VARCHAR"

    def _partition_filter(self) -> str:
        cols = self.partition_columns()
        if cols:
            return f'"{cols[0]}" >= DATEADD(day, -30, CURRENT_DATE())'
        return ""


def _get_snowflake_clustering_columns(conn: BaseBackend, schema: str, table: str) -> list[str]:
    query = f"""
        SELECT clustering_key
        FROM information_schema.tables
        WHERE table_schema = '{schema}' AND table_name = '{table}'
    """
    result = conn.raw_sql(query).fetchone()  # type: ignore[union-attr]
    if not result or not result[0]:
        return []
    return _parse_clustering_key(result[0])


def _parse_clustering_key(clustering_key: str) -> list[str]:
    """Parse Snowflake clustering key string like 'LINEAR(col1, col2)' into column names."""
    match = re.search(r"\((.+)\)", clustering_key)
    if not match:
        return []
    return [col.strip().strip('"') for col in match.group(1).split(",")]


def _resolve_private_key(path: str | None, inline: str | None) -> bytes | None:
    """Return raw PEM bytes from a file path or an inline string, or None."""
    if path and inline:
        raise InitError("Specify either private_key_path or private_key, not both")
    if path:
        with open(path, "rb") as f:
            return f.read()
    if inline:
        return inline.encode()
    return None


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
    private_key: str | None = Field(
        default=None,
        description="PEM-encoded private key string for key-pair authentication (alternative to private_key_path)",
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

        private_key_path = None
        private_key = None
        passphrase = None
        password = None

        if key_pair_auth:
            use_inline = ask_confirm("Paste the private key directly (instead of a file path)?", default=False)
            if use_inline:
                private_key = ask_text("PEM-encoded private key (paste full key):", password=True, required_field=True)
            else:
                private_key_path = ask_text("Path to private key file:", required_field=True)
                if not private_key_path or not os.path.isfile(private_key_path):
                    raise InitError(f"Private key file not found: {private_key_path}")
            passphrase = ask_text("Private key passphrase (optional):", password=True)
        elif not use_sso:
            password = ask_text("Snowflake password:", password=True, required_field=True)
            if not password:
                raise InitError("Snowflake password cannot be empty.")

        return SnowflakeConfig(
            name=name,
            username=username or "",
            password=password,
            account_id=account_id or "",
            database=database or "",
            warehouse=warehouse,
            schema_name=schema,
            private_key_path=private_key_path,
            private_key=private_key,
            passphrase=passphrase,
            authenticator=authenticator,
        )

    def connect(self) -> BaseBackend:
        """Create an Ibis Snowflake connection."""
        from nao_core.deps import require_database_backend

        require_database_backend("snowflake")
        import ibis
        from cryptography.hazmat.backends import default_backend
        from cryptography.hazmat.primitives import serialization

        kwargs: dict = {"user": self.username}
        kwargs["account"] = self.account_id

        if self.database:
            kwargs["database"] = self.database

        if self.warehouse:
            kwargs["warehouse"] = self.warehouse

        if self.authenticator:
            kwargs["authenticator"] = self.authenticator
            UI.info(f"[yellow]Using authenticator: {self.authenticator}[/yellow]")

        pem_data = _resolve_private_key(self.private_key_path, self.private_key)
        if pem_data is not None:
            private_key = serialization.load_pem_private_key(
                pem_data,
                password=self.passphrase.encode() if self.passphrase else None,
                backend=default_backend(),
            )
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

    def create_context(self, conn: BaseBackend, schema: str, table_name: str) -> SnowflakeDatabaseContext:
        return SnowflakeDatabaseContext(conn, schema, table_name)

    def get_semantic_views(self, conn: BaseBackend, schema: str) -> list[dict[str, str]]:
        """Fetch semantic views from a Snowflake schema."""
        try:
            query = f"""
                SELECT NAME, COMMENT
                FROM INFORMATION_SCHEMA.SEMANTIC_VIEWS
                WHERE "SCHEMA" = '{schema}'
                ORDER BY NAME
            """
            rows = conn.raw_sql(query).fetchall()  # type: ignore[union-attr]
            results = []
            for name, comment in rows:
                try:
                    ddl_row = conn.raw_sql(f"SELECT GET_DDL('SEMANTIC VIEW', '{schema}.{name}')").fetchone()  # type: ignore[union-attr]
                    definition = str(ddl_row[0]) if ddl_row and ddl_row[0] else ""
                except Exception:
                    definition = ""
                results.append({"name": name, "comment": str(comment) if comment else "", "definition": definition})
            return results
        except Exception:
            logger.debug("Failed to fetch semantic views for schema %s (feature may not be available)", schema)
            return []

    def get_query_history_sql(self, days: int) -> str | None:
        return (
            f"SELECT query_text AS query_text "
            f"FROM SNOWFLAKE.ACCOUNT_USAGE.QUERY_HISTORY "
            f"WHERE start_time >= DATEADD(day, -{days}, CURRENT_TIMESTAMP()) "
            f"AND execution_status = 'SUCCESS' "
            f"AND query_type = 'SELECT' "
            f"ORDER BY start_time DESC "
            f"LIMIT 10000"
        )

    def check_connection(self) -> tuple[bool, str]:
        """Test connectivity to Snowflake."""
        conn = None
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
        finally:
            if conn is not None:
                conn.disconnect()
