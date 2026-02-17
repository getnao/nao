import pytest

from nao_core.config.databases import TrinoConfig, parse_database_config


def test_parse_database_config_trino():
    config = parse_database_config(
        {
            "type": "trino",
            "name": "trino-prod",
            "host": "trino.company.internal",
            "port": 8080,
            "catalog": "hive",
            "user": "analytics",
            "schema_name": "default",
        }
    )

    assert isinstance(config, TrinoConfig)
    assert config.type == "trino"
    assert config.catalog == "hive"
    assert config.schema_name == "default"


def test_parse_database_config_unknown_type_raises():
    with pytest.raises(ValueError, match="Unknown database type"):
        parse_database_config({"type": "not-real", "name": "x"})
