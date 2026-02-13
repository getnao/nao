from typing import Annotated, Union

from pydantic import Discriminator, Tag

from .base import DatabaseAccessor, DatabaseConfig, DatabaseType
from .bigquery import BigQueryConfig
from .databricks import DatabricksConfig
from .duckdb import DuckDBConfig
from .mssql import MssqlConfig
from .postgres import PostgresConfig
from .redshift import RedshiftConfig
from .snowflake import SnowflakeConfig

# =============================================================================
# Database Config Registry
# =============================================================================

AnyDatabaseConfig = Annotated[
    Union[
        Annotated[BigQueryConfig, Tag("bigquery")],
        Annotated[DatabricksConfig, Tag("databricks")],
        Annotated[SnowflakeConfig, Tag("snowflake")],
        Annotated[DuckDBConfig, Tag("duckdb")],
        Annotated[MssqlConfig, Tag("mssql")],
        Annotated[PostgresConfig, Tag("postgres")],
        Annotated[RedshiftConfig, Tag("redshift")],
    ],
    Discriminator("type"),
]


# Mapping of database type to config class
DATABASE_CONFIG_CLASSES: dict[DatabaseType, type[DatabaseConfig]] = {
    DatabaseType.BIGQUERY: BigQueryConfig,
    DatabaseType.DUCKDB: DuckDBConfig,
    DatabaseType.DATABRICKS: DatabricksConfig,
    DatabaseType.MSSQL: MssqlConfig,
    DatabaseType.SNOWFLAKE: SnowflakeConfig,
    DatabaseType.POSTGRES: PostgresConfig,
    DatabaseType.REDSHIFT: RedshiftConfig,
}


def parse_database_config(data: dict) -> DatabaseConfig:
    """Parse a database config dict into the appropriate type."""
    db_type = data.get("type")
    if db_type == "bigquery":
        return BigQueryConfig.model_validate(data)
    elif db_type == "duckdb":
        return DuckDBConfig.model_validate(data)
    elif db_type == "databricks":
        return DatabricksConfig.model_validate(data)
    elif db_type == "snowflake":
        return SnowflakeConfig.model_validate(data)
    elif db_type == "mssql":
        return MssqlConfig.model_validate(data)
    elif db_type == "postgres":
        return PostgresConfig.model_validate(data)
    elif db_type == "redshift":
        return RedshiftConfig.model_validate(data)
    else:
        raise ValueError(f"Unknown database type: {db_type}")


__all__ = [
    "AnyDatabaseConfig",
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
]
