from __future__ import annotations

from typing import TYPE_CHECKING, Any, Literal, cast

from pydantic import Field

from nao_core.config.exceptions import InitError
from nao_core.ui import ask_text

if TYPE_CHECKING:
    from ibis import BaseBackend

from .base import DatabaseConfig
from .context import DatabaseContext

EXCLUDED_SCHEMAS = {"information_schema", "default", "sys", "pg_catalog", "test"}


def _normalize_schema_name(value: object) -> str:
    """Normalize schema names returned by different Trino drivers/connectors."""
    if value is None:
        return ""
    return str(value).strip().strip('"').strip("'")


def _is_excluded_schema(value: object) -> bool:
    schema = _normalize_schema_name(value).lower()
    return not schema or schema in {"none", "null"} or schema in EXCLUDED_SCHEMAS or schema.startswith("pg_")


def _build_basic_auth(user: str, password: str):
    from trino.auth import BasicAuthentication

    return BasicAuthentication(user, password)


def _build_jwt_auth(token: str):
    from trino.auth import JWTAuthentication

    return JWTAuthentication(token)


class TrinoDatabaseContext(DatabaseContext):
    """Trino context with table/column comment discovery via information_schema."""

    def _trino_catalog(self) -> str:
        return str(cast(Any, self._conn).current_catalog)

    def description(self) -> str | None:
        catalog = self._trino_catalog()
        query = f"""
            SELECT comment
            FROM system.metadata.table_comments
            WHERE catalog_name = '{catalog}'
                AND schema_name = '{self._schema}'
                AND table_name = '{self._table_name}'
        """.strip()
        try:
            row = cast(Any, self._conn).raw_sql(query).fetchone()
            if row and row[0] is not None:
                text = str(row[0]).strip()
                if text:
                    return text
        except Exception:
            pass
        return None

    def columns(self) -> list[dict[str, Any]]:
        cols = super().columns()
        try:
            table_qualified = f"{self._quote(self._schema)}.{self._quote(self._table_name)}"
            query = f"DESCRIBE {table_qualified}"
            rows = cast(Any, self._conn).raw_sql(query).fetchall()
            # Trino DESCRIBE returns columns: Column | Type | Extra | Comment | ...
            # We'll use the first (column name) and fourth (comment) columns.
            descs = {}
            for row in rows:
                if row and len(row) >= 4 and row[0] and row[3]:
                    # Row: (name, type, extra, comment, ...)
                    descs[str(row[0])] = str(row[3]).strip()
            lower = {k.lower(): v for k, v in descs.items()}
            for col in cols:
                name = col["name"]
                desc = descs.get(name) or lower.get(name.lower())
                if desc:
                    col["description"] = desc
        except Exception:
            pass
        return cols

    def _array_unnest_join(self, table_sql: str, col_sql: str, alias: str) -> str:
        return f"{table_sql} CROSS JOIN UNNEST({col_sql}) AS t({alias})"

    def _cast_complex_to_string(self, col_sql: str) -> str:
        return f"CAST({col_sql} AS VARCHAR)"

    def _stddev(self, expr: str) -> str:
        return f"STDDEV_POP({expr})"

    def _numeric_agg_fragments(self, col_sql: str, col: dict) -> list[tuple[str, str]]:
        col_type = self._normalize_type(col["type"])
        is_numeric = self._is_numeric_stats_column(col)
        is_date = any(t in col_type.lower() for t in ("date", "timestamp", "time"))

        frags = []
        if is_numeric:
            frags.append(("col_min", f"MIN({col_sql})"))
            frags.append(("col_max", f"MAX({col_sql})"))
            frags.append(("col_mean", f"AVG({self._cast_float(col_sql)})"))
            frags.append(("col_stddev", f"{self._stddev(self._cast_float(col_sql))}"))
        elif is_date:
            frags.append(("col_min", f"CAST(MIN({col_sql}) AS VARCHAR)"))
            frags.append(("col_max", f"CAST(MAX({col_sql}) AS VARCHAR)"))
        return frags

    def _build_top_values_query(self, col: dict) -> str:
        col_sql = self._quote(col["name"])
        table_sql = f"{self._quote(self._schema)}.{self._quote(self._table_name)}"
        partition_filter = self._partition_filter()
        where_clause = f"WHERE {partition_filter}" if partition_filter else ""
        return f"""
            SELECT {col_sql} AS value, COUNT(*) AS cnt
            FROM {table_sql}
            {where_clause}
            GROUP BY {col_sql}
            ORDER BY cnt DESC, {col_sql} ASC
            LIMIT 10
        """.strip()


class TrinoConfig(DatabaseConfig):
    """Trino-specific configuration."""

    type: Literal["trino"] = "trino"
    host: str = Field(description="Trino coordinator host")
    port: int = Field(default=8080, description="Trino coordinator port")
    catalog: str = Field(description="Catalog name")
    user: str = Field(description="Username")
    schema_name: str | None = Field(default=None, description="Default schema (optional)")
    password: str | None = Field(default=None, description="Password (optional)")
    http_scheme: Literal["http", "https"] = Field(
        default="http",
        description="HTTP scheme used to reach the coordinator. Default 'http' preserves prior behaviour.",
    )
    verify: bool | str = Field(
        default=True,
        description=(
            "TLS verification when http_scheme='https'. "
            "True = verify with system CAs, False = disable verification, "
            "str = path to a CA bundle. Ignored for plain http."
        ),
    )
    jwt_token: str | None = Field(
        default=None,
        description=(
            "Bearer JWT for Trino's OAuth2/JWT authenticator. When set, takes "
            "precedence over password and forces http_scheme='https'."
        ),
    )
    jwt_token_file: str | None = Field(
        default=None,
        description=(
            "Path to a file containing the Bearer JWT, re-read on every "
            "connect(). Lets an external refresher rotate short-lived tokens "
            "without rewriting the config. Takes precedence over jwt_token."
        ),
    )

    def _resolve_jwt(self) -> str | None:
        """Read the JWT from file (fresh each call) or fall back to the inline token.

        Both sources are stripped; a blank or whitespace-only value resolves to
        None so it can't spuriously force https, enable JWT auth, or block the
        password fallback.
        """
        if self.jwt_token_file:
            try:
                with open(self.jwt_token_file, encoding="utf-8") as fh:
                    token = fh.read().strip()
                if token:
                    return token
            except OSError:
                pass
        if self.jwt_token:
            token = self.jwt_token.strip()
            if token:
                return token
        return None

    @classmethod
    def promptConfig(cls) -> "TrinoConfig":
        """Interactively prompt the user for Trino configuration."""
        name = ask_text("Connection name:", default="trino-prod") or "trino-prod"
        host = ask_text("Host:", default="localhost") or "localhost"

        scheme_str = ask_text("Use HTTPS (y/n):", default="n") or "n"
        use_https = scheme_str.strip().lower().startswith("y")
        http_scheme: Literal["http", "https"] = "https" if use_https else "http"

        default_port = "8443" if use_https else "8080"
        port_str = ask_text("Port:", default=default_port) or default_port
        if not port_str.isdigit():
            raise InitError("Port must be a valid integer.")

        verify: bool | str = True
        if use_https:
            ca_path = (ask_text("Custom CA bundle path (leave empty for system CAs):") or "").strip()
            if ca_path:
                verify = ca_path

        catalog = ask_text("Catalog name:", required_field=True)
        user = ask_text("Username:", required_field=True)
        password = ask_text("Password (optional):", password=True) or None
        schema_name = ask_text("Default schema (optional):")

        return TrinoConfig(
            name=name,
            host=host,
            port=int(port_str),
            catalog=catalog,  # type: ignore[arg-type]
            user=user,  # type: ignore[arg-type]
            password=password,
            schema_name=schema_name,
            http_scheme=http_scheme,
            verify=verify,
        )

    def connect(self) -> BaseBackend:
        """Create an Ibis Trino connection."""
        from nao_core.deps import require_database_backend

        require_database_backend("trino")
        import ibis

        jwt = self._resolve_jwt()
        # A JWT requires TLS; force https so a stray http_scheme can't leak the
        # bearer token over cleartext.
        http_scheme = "https" if jwt else self.http_scheme

        kwargs: dict = {
            "host": self.host,
            "port": self.port,
            "user": self.user,
            "database": self.catalog,
            "http_scheme": http_scheme,
        }

        if http_scheme == "https":
            kwargs["verify"] = self.verify

        if self.schema_name:
            kwargs["schema"] = self.schema_name

        # Auth precedence: JWT (OAuth2/JWT authenticator) > basic password.
        if jwt:
            kwargs["auth"] = _build_jwt_auth(jwt)
        elif self.password:
            kwargs["auth"] = _build_basic_auth(self.user, self.password)

        return ibis.trino.connect(**kwargs)

    def get_database_name(self) -> str:
        """Get the database name for Trino."""
        return self.catalog

    def get_schemas(self, conn: BaseBackend) -> list[str]:
        if self.schema_name:
            return [self.schema_name]

        # Prefer Trino-native listing to avoid backend-specific list_databases behavior.
        try:
            escaped_catalog = self.catalog.replace('"', '""')
            rows = conn.raw_sql(f'SHOW SCHEMAS FROM "{escaped_catalog}"').fetchall()  # type: ignore[union-attr]
            schemas = [
                _normalize_schema_name(row[0]) for row in rows if row and row[0] and not _is_excluded_schema(row[0])
            ]
            return sorted(set(schemas))
        except Exception:
            pass

        list_databases = getattr(conn, "list_databases", None)
        if list_databases:
            try:
                schemas = [_normalize_schema_name(s) for s in list_databases() if not _is_excluded_schema(s)]
                return sorted(set(schemas))
            except Exception:
                return []

        return []

    def create_context(self, conn: BaseBackend, schema: str, table_name: str) -> TrinoDatabaseContext:
        return TrinoDatabaseContext(conn, schema, table_name)

    def check_connection(self) -> tuple[bool, str]:
        """Test connectivity to Trino."""
        try:
            conn = self.connect()
            if self.schema_name:
                tables = conn.list_tables(database=self.schema_name)
                return True, f"Connected successfully ({len(tables)} tables found)"

            schemas = self.get_schemas(conn)
            return True, f"Connected successfully ({len(schemas)} schemas found)"
        except Exception as e:
            return False, str(e)
