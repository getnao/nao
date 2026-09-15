from __future__ import annotations

from typing import TYPE_CHECKING, Literal

from pydantic import BaseModel, Field, model_validator

from nao_core.ui import ask_text

if TYPE_CHECKING:
    from ibis import BaseBackend

from .base import DatabaseConfig
from .duckdb import DuckDBDatabaseContext

_SERVER_CATALOGS = ("postgres", "mysql")
_FILE_CATALOGS = ("sqlite", "duckdb")
_DEFAULT_CATALOG_PORTS = {"postgres": 5432, "mysql": 3306}


class DuckLakeDatabaseContext(DuckDBDatabaseContext):
    """DuckDB context for a catalog-qualified DuckLake schema (``lake.main``).

    ``get_schemas()`` returns schema names qualified with the lake's attach alias
    so they resolve against the right catalog. Ibis's ``table(name, database=...)``
    already parses that dotted string correctly, so ``self._schema`` is kept whole
    for the inherited Ibis-backed paths (``columns()``, ``preview()``, ``row_count()``).
    Only the base class's raw-SQL query builders need the split: they quote
    ``self._schema`` as a single identifier, which produces an invalid
    ``"lake.main"."sales"`` reference. ``_qualified_table_sql()`` splits the alias
    out on demand and emits three-part SQL instead.
    """

    def _qualified_table_sql(self) -> str:
        catalog, separator, bare_schema = self._schema.partition(".")
        if not separator:
            return f"{self._quote(self._schema)}.{self._quote(self._table_name)}"
        return f"{self._quote(catalog)}.{self._quote(bare_schema)}.{self._quote(self._table_name)}"


class DuckLakeCatalogConfig(BaseModel):
    """Metadata catalog backing a DuckLake, either a server or a local file."""

    type: Literal["postgres", "mysql", "sqlite", "duckdb"] = Field(
        description="Catalog backend holding DuckLake metadata"
    )
    host: str | None = Field(default=None, description="Catalog host (server catalogs only)")
    port: int | None = Field(default=None, description="Catalog port (defaults per catalog type)")
    database: str | None = Field(default=None, description="Catalog database name (server catalogs only)")
    user: str | None = Field(default=None, description="Catalog username (server catalogs only)")
    password: str | None = Field(default=None, description="Catalog password (server catalogs only)")
    path: str | None = Field(default=None, description="Catalog file path (file catalogs only)")

    @model_validator(mode="after")
    def _check_fields_match_type(self) -> "DuckLakeCatalogConfig":
        if self.type in _SERVER_CATALOGS:
            if not (self.host and self.database and self.user and self.password is not None):
                raise ValueError(f"A '{self.type}' DuckLake catalog requires host, database, user and password")
            if self.port is None:
                self.port = _DEFAULT_CATALOG_PORTS[self.type]
        elif not self.path:
            raise ValueError(f"A '{self.type}' DuckLake catalog requires 'path'")
        return self


class DuckLakeStorageConfig(BaseModel):
    """Object-storage credentials for the DuckLake data path."""

    type: Literal["s3"] = Field(default="s3", description="Storage backend type")
    key_id: str = Field(description="Access key id")
    secret: str = Field(description="Secret access key")
    region: str | None = Field(default=None, description="Storage region")
    endpoint: str | None = Field(default=None, description="Custom endpoint (MinIO, R2)")
    url_style: str | None = Field(default=None, description="URL style, 'path' for MinIO")
    use_ssl: bool = Field(default=True, description="Whether the endpoint uses TLS")


class DuckLakeConfig(DatabaseConfig):
    """DuckLake configuration: a metadata catalog plus a data path, attached read-only."""

    type: Literal["ducklake"] = "ducklake"
    catalog: DuckLakeCatalogConfig = Field(description="Catalog holding DuckLake metadata")
    data_path: str = Field(description="Where DuckLake stores data files (local path or s3:// URI)")
    schema_name: str | None = Field(default=None, description="Restrict sync to a single lake schema (optional)")
    metadata_schema: str | None = Field(
        default=None,
        description="Catalog schema holding the ducklake_* metadata tables (default: the catalog's own default schema)",
    )
    storage: DuckLakeStorageConfig | None = Field(
        default=None, description="Object-storage credentials (omit for a local data_path)"
    )

    @classmethod
    def promptConfig(cls) -> "DuckLakeConfig":
        """Interactively prompt the user for DuckLake configuration."""
        name = ask_text("Connection name:", default="ducklake") or "ducklake"
        catalog_type = ask_text("Catalog type (postgres/mysql/sqlite/duckdb):", default="postgres") or "postgres"

        if catalog_type in _FILE_CATALOGS:
            catalog = DuckLakeCatalogConfig(
                type=catalog_type,  # type: ignore[arg-type]
                path=ask_text("Catalog file path:", required_field=True),
            )
        else:
            default_port = str(_DEFAULT_CATALOG_PORTS.get(catalog_type, 5432))
            catalog = DuckLakeCatalogConfig(
                type=catalog_type,  # type: ignore[arg-type]
                host=ask_text("Catalog host:", default="localhost") or "localhost",
                port=int(ask_text("Catalog port:", default=default_port) or default_port),
                database=ask_text("Catalog database name:", required_field=True),
                user=ask_text("Catalog username:", required_field=True),
                password=ask_text("Catalog password:", password=True) or "",
            )

        data_path = ask_text("Data path (local dir or s3://bucket/prefix):", required_field=True)
        return DuckLakeConfig(name=name, catalog=catalog, data_path=data_path)  # type: ignore[arg-type]

    def catalog_connection_string(self) -> str:
        """Build the catalog part of the DuckLake ATTACH target."""
        catalog = self.catalog
        if catalog.type in _SERVER_CATALOGS:
            return f"{catalog.type}:"
        if catalog.type == "sqlite":
            return f"sqlite:{catalog.path}"
        return str(catalog.path)

    def get_database_name(self) -> str:
        """Get the database name for DuckLake."""
        return self.name

    def create_context(self, conn: BaseBackend, schema: str, table_name: str) -> DuckLakeDatabaseContext:
        return DuckLakeDatabaseContext(conn, schema, table_name)

    def connection_statements(self) -> list[str]:
        """SQL run after connecting: extensions, secrets, the attach, then the lockdown.

        Order is load-bearing, not stylistic:
          1. Extensions must load before any lockdown — a locked-down session refuses
             to load the ducklake/catalog/httpfs extensions at all.
          2. Secrets must exist before ATTACH, which needs them to reach the catalog
             and object store.
          3. ATTACH must run before the lockdown — with external access already
             disabled, attaching a Postgres-backed catalog fails outright
             ("Attaching Postgres databases is disabled through configuration").
          4. ``allowed_directories`` must be set before ``enable_external_access``
             is turned off — DuckDB refuses to change ``allowed_directories`` once
             external access is disabled, and refuses to re-enable external access
             at all once the session is running. So the lockdown pair below is
             itself order-sensitive and irreversible: get it wrong and there is no
             second chance within the same session.
        ``allowed_directories`` is scoped to exactly the lake's own DATA_PATH, not
        left empty: DuckLake reads column data by reopening the underlying Parquet
        files by path, and an empty allowlist blocks that reopen even though the
        ATTACH itself already succeeded — verified live, ``COUNT(*)`` (answered from
        catalog stats) kept working with an empty list, but ``SELECT`` of an actual
        column failed with the same "file system operations are disabled" error
        that this lockdown is meant to raise for anything outside the lake.
        """
        statements = ["INSTALL ducklake", "LOAD ducklake"]

        if self.catalog.type in ("postgres", "mysql", "sqlite"):
            statements += [f"INSTALL {self.catalog.type}", f"LOAD {self.catalog.type}"]

        if self.catalog.type in _SERVER_CATALOGS:
            statements.append(self._catalog_secret_statement())

        if self._needs_remote_storage():
            statements += ["INSTALL httpfs", "LOAD httpfs"]

        if self.storage is not None:
            statements.append(self._storage_secret_statement())

        statements.append(self._attach_statement())
        statements += [
            f"SET allowed_directories = [{_quote(self.data_path)}]",
            "SET enable_external_access = false",
        ]
        return statements

    def connect(self) -> BaseBackend:
        """Create an Ibis DuckDB session with the DuckLake catalog attached read-only.

        External access is disabled only after the attach (see ``connection_statements``),
        so the extension loads, the catalog and storage secrets apply, and the lake
        attaches successfully before local filesystem and network access are cut off.
        """
        from nao_core.deps import require_database_backend

        require_database_backend("duckdb", extra="duckdb", database_type="ducklake")
        import ibis

        conn = ibis.duckdb.connect(database=":memory:", read_only=False)
        for statement in self.connection_statements():
            try:
                conn.raw_sql(statement)
            except Exception as error:
                conn.disconnect()
                raise RuntimeError(self.translate_connection_error(str(error))) from error
        return conn

    def check_connection(self) -> tuple[bool, str]:
        """Test connectivity to the DuckLake catalog."""
        conn = None
        try:
            conn = self.connect()
            schemas = self.get_schemas(conn)
            return True, f"Connected successfully ({len(schemas)} schemas found)"
        except Exception as e:
            return False, self.translate_connection_error(str(e))
        finally:
            if conn is not None:
                conn.disconnect()

    def get_schemas(self, conn: BaseBackend) -> list[str]:
        """Return the lake's schemas, qualified with the catalog alias.

        The inherited implementation falls back to ``list_databases()``, which mixes
        the attached lake's schemas with the in-memory session's system schemas.
        Qualification matters just as much: sync passes these names straight to
        ``list_tables(database=...)``, and a bare name resolves against the session
        and returns an empty list without raising.
        """
        if self.schema_name:
            return [f"{self.name}.{self.schema_name}"]
        rows = conn.raw_sql(self.schema_discovery_sql()).fetchall()  # type: ignore[union-attr]
        return [f"{self.name}.{row[0]}" for row in rows]

    def schema_discovery_sql(self) -> str:
        """Query listing the attached lake's non-internal schemas."""
        return (
            "SELECT schema_name FROM duckdb_schemas() "
            f"WHERE database_name = {_quote(self.name)} AND NOT internal ORDER BY schema_name"
        )

    def translate_connection_error(self, message: str) -> str:
        """Turn raw DuckDB failures into messages a user can act on.

        The recognised cases below build their own fixed text and never echo *message*, but
        the passthrough case can — DuckDB error text has been observed to echo credentials
        verbatim (e.g. a malformed CREATE SECRET statement), and this message reaches the
        LLM agent's context, so it goes through `_redact_secrets` as defence in depth.
        """
        if "Could not set lock on file" in message or "Unique file handle conflict" in message:
            return (
                f"DuckLake catalog '{self.catalog.path}' is locked by another process — file-based catalogs "
                "allow a single connection at a time; use a postgres or mysql catalog for concurrent access"
            )
        if "403" in message or "InvalidAccessKeyId" in message or "SignatureDoesNotMatch" in message:
            return "Storage access denied — check the storage.key_id and storage.secret values in nao_config.yaml"
        if "Catalog Error" in message and "does not exist" in message:
            return f"DuckLake catalog not found at '{self.catalog_connection_string()}'"
        return self._redact_secrets(message)

    def _redact_secrets(self, message: str) -> str:
        """Replace any configured credential values that appear verbatim in *message*."""
        secrets = [self.catalog.password]
        if self.storage is not None:
            secrets += [self.storage.secret, self.storage.key_id]
        for secret in secrets:
            if secret:
                message = message.replace(secret, "[redacted]")
        return message

    def _needs_remote_storage(self) -> bool:
        return self.data_path.startswith(("s3://", "gcs://", "gs://", "r2://", "az://", "azure://"))

    def _storage_secret_statement(self) -> str:
        storage = self.storage
        assert storage is not None
        fields = [
            "TYPE s3",
            f"KEY_ID {_quote(storage.key_id)}",
            f"SECRET {_quote(storage.secret)}",
        ]
        if storage.region:
            fields.append(f"REGION {_quote(storage.region)}")
        if storage.endpoint:
            fields.append(f"ENDPOINT {_quote(storage.endpoint)}")
        if storage.url_style:
            fields.append(f"URL_STYLE {_quote(storage.url_style)}")
        if not storage.use_ssl:
            fields.append("USE_SSL false")
        return f"CREATE OR REPLACE SECRET nao_ducklake_storage ({', '.join(fields)})"

    def _catalog_secret_statement(self) -> str:
        """Pass server catalog credentials through a secret.

        DuckDB echoes the ATTACH connection string back in its errors, and that text
        reaches the agent, so the password must never appear in it.
        """
        catalog = self.catalog
        fields = [
            f"TYPE {catalog.type}",
            f"HOST {_quote(str(catalog.host))}",
            f"PORT {catalog.port}",
            f"DATABASE {_quote(str(catalog.database))}",
            f"USER {_quote(str(catalog.user))}",
            f"PASSWORD {_quote(str(catalog.password))}",
        ]
        return f"CREATE OR REPLACE SECRET __default_{catalog.type} ({', '.join(fields)})"

    def _attach_statement(self) -> str:
        """Build the ATTACH, including METADATA_SCHEMA when the lake keeps its metadata elsewhere.

        A lake whose ``ducklake_*`` tables live outside the catalog's default schema is
        invisible without METADATA_SCHEMA: the attach does not fall back to searching other
        schemas, it reports "Existing DuckLake ... does not exist" and — but for READ_ONLY —
        would offer to create a fresh empty lake over the existing data path.
        """
        target = _quote(f"ducklake:{self.catalog_connection_string()}")
        options = [f"DATA_PATH {_quote(self.data_path)}"]
        if self.metadata_schema:
            options.append(f"METADATA_SCHEMA {_quote(self.metadata_schema)}")
        options.append("READ_ONLY")
        return f"ATTACH {target} AS {_quote_identifier(self.name)} ({', '.join(options)})"


def _quote(value: str) -> str:
    """Quote a SQL string literal."""
    escaped = value.replace("'", "''")
    return f"'{escaped}'"


def _quote_identifier(identifier: str) -> str:
    """Quote a SQL identifier."""
    escaped = identifier.replace('"', '""')
    return f'"{escaped}"'
