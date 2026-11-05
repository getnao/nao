"""Unit tests for Athena database config."""

from nao_core.config.databases.athena import AthenaConfig


def test_catalog_is_the_glue_catalog_not_the_schema() -> None:
    config = AthenaConfig(name="a", s3_staging_dir="s3://results", region_name="us-east-1", schema_name="analytics")

    assert config.get_database_name() == "analytics"
    assert config.get_catalog_names() == ["awsdatacatalog"]
