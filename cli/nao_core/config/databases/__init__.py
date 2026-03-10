from typing import Annotated, Union

from pydantic import Discriminator, Tag

from .athena import AthenaConfig
from .base import DatabaseAccessor, DatabaseConfig, DatabaseType
from .bigquery import BigQueryConfig
from .databricks import DatabricksConfig
from .duckdb import DuckDBConfig
from .mssql import MssqlConfig
from .postgres import PostgresConfig
from .redshift import RedshiftConfig
from .snowflake import SnowflakeConfig
from .trino import TrinoConfig

# =============================================================================
# Database Config Registry
# =============================================================================

AnyDatabaseConfig = Annotated[
    Union[
        Annotated[AthenaConfig, Tag("athena")],
        Annotated[BigQueryConfig, Tag("bigquery")],
        Annotated[DatabricksConfig, Tag("databricks")],
        Annotated[SnowflakeConfig, Tag("snowflake")],
        Annotated[DuckDBConfig, Tag("duckdb")],
        Annotated[MssqlConfig, Tag("mssql")],
        Annotated[PostgresConfig, Tag("postgres")],
        Annotated[RedshiftConfig, Tag("redshift")],
        Annotated[TrinoConfig, Tag("trino")],
    ],
    Discriminator("type"),
]


# Mapping of database type to config class
DATABASE_CONFIG_CLASSES: dict[DatabaseType, type[DatabaseConfig]] = {
    DatabaseType.ATHENA: AthenaConfig,
    DatabaseType.BIGQUERY: BigQueryConfig,
    DatabaseType.DUCKDB: DuckDBConfig,
    DatabaseType.DATABRICKS: DatabricksConfig,
    DatabaseType.MSSQL: MssqlConfig,
    DatabaseType.SNOWFLAKE: SnowflakeConfig,
    DatabaseType.POSTGRES: PostgresConfig,
    DatabaseType.REDSHIFT: RedshiftConfig,
    DatabaseType.TRINO: TrinoConfig,
}


def parse_database_config(data: dict) -> DatabaseConfig:
    """Parse a database config dict into the appropriate type."""
    raw_type = data.get("type")
    if not isinstance(raw_type, str):
        raise ValueError(f"Unknown database type: {raw_type}")

    try:
        db_type = DatabaseType(raw_type)
    except ValueError as e:
        raise ValueError(f"Unknown database type: {raw_type}") from e
    config_class = DATABASE_CONFIG_CLASSES[db_type]
    return config_class.model_validate(data)


__all__ = [
    "AnyDatabaseConfig",
    "AthenaConfig",
    "BigQueryConfig",
    "DATABASE_CONFIG_CLASSES",
    "DatabaseAccessor",
    "DatabaseConfig",
    "DatabaseType",
    "DuckDBConfig",
    "DatabricksConfig",
    "MssqlConfig",
    "SnowflakeConfig",
    "PostgresConfig",
    "RedshiftConfig",
    "TrinoConfig",
]
