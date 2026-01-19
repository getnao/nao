from .base import AccessorType, DatabaseConfig, DatabaseType
from .bigquery import BigQueryConfig
from .snowflake import SnowflakeConfig

# =============================================================================
# Database Config Registry
# =============================================================================

# When adding more backends, convert this to a discriminated union:
# AnyDatabaseConfig = Annotated[
#     Union[
#         Annotated[BigQueryConfig, Tag("bigquery")],
#         Annotated[PostgresConfig, Tag("postgres")],
#     ],
#     Discriminator(lambda x: x.get("type", "bigquery")),
# ]

AnyDatabaseConfig = BigQueryConfig


def parse_database_config(data: dict) -> DatabaseConfig:
    """Parse a database config dict into the appropriate type."""
    db_type = data.get("type")
    if db_type == "bigquery":
        return BigQueryConfig.model_validate(data)
    elif db_type == "snowflake":
        return SnowflakeConfig.model_validate(data)
    else:
        raise ValueError(f"Unknown database type: {db_type}")


__all__ = ["AccessorType", "DatabaseConfig", "DatabaseType", "BigQueryConfig", "SnowflakeConfig", "AnyDatabaseConfig"]
