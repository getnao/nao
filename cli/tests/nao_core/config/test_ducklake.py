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


def _config(**overrides: object) -> DuckLakeConfig:
    payload: dict[str, object] = {
        "type": "ducklake",
        "name": "lake",
        "catalog": {"type": "duckdb", "path": "/data/catalog.ducklake"},
        "data_path": "/data/lake/",
    }
    payload.update(overrides)
    return parse_database_config(payload)  # type: ignore[return-value]


def test_local_file_catalog_statements() -> None:
    statements = _config().connection_statements()
    assert statements == [
        "INSTALL ducklake",
        "LOAD ducklake",
        "ATTACH 'ducklake:/data/catalog.ducklake' AS \"lake\" (DATA_PATH '/data/lake/', READ_ONLY)",
    ]


def test_postgres_catalog_loads_its_driver() -> None:
    statements = _config(
        catalog={
            "type": "postgres",
            "host": "localhost",
            "database": "cat",
            "user": "u",
            "password": "p",
        }
    ).connection_statements()
    assert "INSTALL postgres" in statements
    assert statements.index("LOAD postgres") < statements.index([s for s in statements if s.startswith("ATTACH")][0])


def test_remote_storage_adds_httpfs_and_secret() -> None:
    statements = _config(
        data_path="s3://bucket/warehouse/",
        storage={
            "type": "s3",
            "key_id": "KEY",
            "secret": "SECRET",
            "region": "eu-west-1",
            "endpoint": "localhost:9010",
            "url_style": "path",
            "use_ssl": False,
        },
    ).connection_statements()

    assert "LOAD httpfs" in statements
    secret = next(s for s in statements if "CREATE OR REPLACE SECRET" in s)
    assert "KEY_ID 'KEY'" in secret
    assert "REGION 'eu-west-1'" in secret
    assert "ENDPOINT 'localhost:9010'" in secret
    assert "URL_STYLE 'path'" in secret
    assert "USE_SSL false" in secret
    assert statements.index(secret) < statements.index([s for s in statements if s.startswith("ATTACH")][0])


def test_server_catalog_password_never_reaches_the_attach() -> None:
    """DuckDB echoes the ATTACH string in errors that reach the agent."""
    statements = _config(
        catalog={
            "type": "postgres",
            "host": "localhost",
            "database": "cat",
            "user": "u",
            "password": "SUPERSECRET",
        }
    ).connection_statements()

    attach = next(s for s in statements if s.startswith("ATTACH"))
    assert "SUPERSECRET" not in attach
    assert "ducklake:postgres:" in attach

    secret = next(s for s in statements if "__default_postgres" in s)
    assert "PASSWORD 'SUPERSECRET'" in secret
    assert statements.index(secret) < statements.index(attach)


def test_local_data_path_needs_no_httpfs() -> None:
    statements = _config().connection_statements()
    assert not any("httpfs" in s for s in statements)
    assert not any("SECRET" in s for s in statements)


def test_no_lockdown_statements_are_emitted() -> None:
    statements = _config().connection_statements()
    assert not any("enable_external_access" in s for s in statements)
    assert not any("lock_configuration" in s for s in statements)


def test_single_quotes_in_values_are_escaped() -> None:
    statements = _config(data_path="/data/o'brien/").connection_statements()
    attach = next(s for s in statements if s.startswith("ATTACH"))
    assert "DATA_PATH '/data/o''brien/'" in attach


def test_lock_error_is_translated() -> None:
    cfg = _config()
    message = cfg.translate_connection_error('Could not set lock on file "/data/catalog.ducklake"')
    assert "locked by another process" in message
    assert "postgres or mysql catalog" in message


def test_storage_denied_error_is_translated() -> None:
    cfg = _config()
    assert "storage.key_id" in cfg.translate_connection_error("HTTP 403 InvalidAccessKeyId")


def test_unknown_error_is_passed_through() -> None:
    cfg = _config()
    assert cfg.translate_connection_error("some other failure") == "some other failure"
