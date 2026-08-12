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

    def create_context(self, conn: BaseBackend, schema: str, table_name: str) -> DuckDBDatabaseContext:
        return DuckDBDatabaseContext(conn, schema, table_name)

    def connect(self) -> BaseBackend:
        """Create an Ibis connection for this database."""
        raise NotImplementedError("DuckLake connection support is not implemented yet — this lands in Task 2")
