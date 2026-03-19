from typing import Annotated, Dict, Type, Union, cast

from pydantic import BaseModel, Discriminator, Tag

from .athena import AthenaConfig
from .base import DatabaseAccessor, DatabaseConfig, DatabaseType
from .bigquery import BigQueryConfig
from .clickhouse import ClickHouseConfig
from .databricks import DatabricksConfig
from .duckdb import DuckDBConfig
from .fabric import FabricConfig
from .mssql import MssqlConfig
from .mysql import MysqlConfig
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
        Annotated[ClickHouseConfig, Tag("clickhouse")],
        Annotated[DatabricksConfig, Tag("databricks")],
        Annotated[FabricConfig, Tag("fabric")],
        Annotated[SnowflakeConfig, Tag("snowflake")],
        Annotated[DuckDBConfig, Tag("duckdb")],
        Annotated[MysqlConfig, Tag("mysql")],
        Annotated[MssqlConfig, Tag("mssql")],
        Annotated[PostgresConfig, Tag("postgres")],
        Annotated[RedshiftConfig, Tag("redshift")],
        Annotated[TrinoConfig, Tag("trino")],
    ],
    Discriminator("type"),
]


# Mapping of database type to config class
DATABASE_CONFIG_CLASSES: Dict[DatabaseType, Type[object]] = {
    DatabaseType.ATHENA: AthenaConfig,
    DatabaseType.BIGQUERY: BigQueryConfig,
    DatabaseType.CLICKHOUSE: ClickHouseConfig,
    DatabaseType.DUCKDB: DuckDBConfig,
    DatabaseType.DATABRICKS: DatabricksConfig,
    DatabaseType.FABRIC: FabricConfig,
    DatabaseType.MSSQL: MssqlConfig,
    DatabaseType.MYSQL: MysqlConfig,
    DatabaseType.SNOWFLAKE: SnowflakeConfig,
    DatabaseType.POSTGRES: PostgresConfig,
    DatabaseType.REDSHIFT: RedshiftConfig,
    DatabaseType.TRINO: TrinoConfig,
}


def parse_database_config(data: dict) -> AnyDatabaseConfig:
    """Parse a database config dict into the appropriate type."""
    raw_type = data.get("type")
    if not isinstance(raw_type, str):
        raise ValueError(f"Unknown database type: {raw_type}")

    try:
        db_type = DatabaseType(raw_type)
    except ValueError as e:
        raise ValueError(f"Unknown database type: {raw_type}") from e
    config_class = cast(Type[BaseModel], DATABASE_CONFIG_CLASSES[db_type])
    return cast(AnyDatabaseConfig, config_class.model_validate(data))


__all__ = [
    "AnyDatabaseConfig",
    "AthenaConfig",
    "BigQueryConfig",
    "ClickHouseConfig",
    "DATABASE_CONFIG_CLASSES",
    "DatabaseAccessor",
    "DatabaseConfig",
    "DatabaseType",
    "DuckDBConfig",
    "DatabricksConfig",
    "FabricConfig",
    "MssqlConfig",
    "MysqlConfig",
    "SnowflakeConfig",
    "PostgresConfig",
    "RedshiftConfig",
    "TrinoConfig",
]
