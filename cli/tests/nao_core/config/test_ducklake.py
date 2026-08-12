from __future__ import annotations

import pytest
from pydantic import ValidationError

from nao_core.config.base import NaoConfig
from nao_core.config.databases import parse_database_config
from nao_core.config.databases.base import DatabaseType
from nao_core.config.databases.ducklake import DuckLakeCatalogConfig, DuckLakeConfig
from nao_core.deps import get_required_extras


def test_database_type_includes_ducklake() -> None:
    assert DatabaseType.DUCKLAKE.value == "ducklake"
    labels = {choice.title: choice.value for choice in DatabaseType.choices()}
    assert labels["DuckLake"] == "ducklake"


def test_parse_server_catalog_config() -> None:
    cfg = parse_database_config(
        {
            "type": "ducklake",
            "name": "analytics-lake",
            "catalog": {
                "type": "postgres",
                "host": "localhost",
                "database": "ducklake_catalog",
                "user": "ducklake",
                "password": "secret",
            },
            "data_path": "s3://ducklake/warehouse/",
        }
    )
    assert isinstance(cfg, DuckLakeConfig)
    assert cfg.catalog.port == 5432
    assert cfg.get_database_name() == "analytics-lake"
    assert cfg.catalog_connection_string() == "postgres:"
    assert "secret" not in cfg.catalog_connection_string()


def test_mysql_catalog_defaults_to_3306() -> None:
    cfg = parse_database_config(
        {
            "type": "ducklake",
            "name": "lake",
            "catalog": {
                "type": "mysql",
                "host": "db",
                "database": "cat",
                "user": "u",
                "password": "p",
            },
            "data_path": "/data/lake/",
        }
    )
    assert isinstance(cfg, DuckLakeConfig)
    assert cfg.catalog.port == 3306
    assert cfg.catalog_connection_string() == "mysql:"


def test_file_catalog_uses_path() -> None:
    cfg = parse_database_config(
        {
            "type": "ducklake",
            "name": "lake",
            "catalog": {"type": "duckdb", "path": "/data/catalog.ducklake"},
            "data_path": "/data/lake/",
        }
    )
    assert isinstance(cfg, DuckLakeConfig)
    assert cfg.catalog_connection_string() == "/data/catalog.ducklake"


def test_sqlite_catalog_is_prefixed() -> None:
    cfg = parse_database_config(
        {
            "type": "ducklake",
            "name": "lake",
            "catalog": {"type": "sqlite", "path": "/data/catalog.sqlite"},
            "data_path": "/data/lake/",
        }
    )
    assert isinstance(cfg, DuckLakeConfig)
    assert cfg.catalog_connection_string() == "sqlite:/data/catalog.sqlite"


def test_server_catalog_requires_host() -> None:
    with pytest.raises(ValidationError, match="host, database, user and password"):
        parse_database_config(
            {
                "type": "ducklake",
                "name": "lake",
                "catalog": {"type": "postgres", "path": "/nope"},
                "data_path": "/data/",
            }
        )


def test_file_catalog_requires_path() -> None:
    with pytest.raises(ValidationError, match="requires 'path'"):
        parse_database_config(
            {
                "type": "ducklake",
                "name": "lake",
                "catalog": {"type": "duckdb", "host": "localhost"},
                "data_path": "/data/",
            }
        )


def test_hyphenated_connection_name_is_accepted() -> None:
    """The repo's own names use hyphens (postgres-prod, duckdb-local)."""
    cfg = parse_database_config(
        {
            "type": "ducklake",
            "name": "analytics-lake",
            "catalog": {"type": "duckdb", "path": "/c.ducklake"},
            "data_path": "/data/",
        }
    )
    assert cfg.get_database_name() == "analytics-lake"


def test_ducklake_requires_the_duckdb_extra() -> None:
    config = NaoConfig(
        project_name="lake-project",
        databases=[
            DuckLakeConfig(
                name="lake",
                catalog=DuckLakeCatalogConfig(type="duckdb", path="/data/catalog.ducklake"),
                data_path="/data/lake/",
            )
        ],
    )
    assert get_required_extras(config) == ["duckdb"]
