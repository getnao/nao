import os
from unittest.mock import MagicMock, patch

from nao_core.config.databases import parse_database_config
from nao_core.config.databases.base import DatabaseType
from nao_core.config.databases.duckdb import DuckDBDatabaseContext
from nao_core.config.databases.motherduck import MotherDuckConfig


def test_registered_in_enum_and_registry():
    """MotherDuck is a first-class database type."""
    from nao_core.config.databases import DATABASE_CONFIG_CLASSES

    assert DatabaseType("motherduck") is DatabaseType.MOTHERDUCK
    assert DATABASE_CONFIG_CLASSES[DatabaseType.MOTHERDUCK] is MotherDuckConfig
    assert any(choice.value == "motherduck" for choice in DatabaseType.choices())


def test_parse_from_dict_uses_discriminated_union():
    cfg = parse_database_config({"type": "motherduck", "name": "md", "database": "my_db"})
    assert isinstance(cfg, MotherDuckConfig)
    assert cfg.database == "my_db"
    assert cfg.read_only is False


def test_get_database_name_defaults_when_unset():
    assert MotherDuckConfig(name="md").get_database_name() == "my_db"
    assert MotherDuckConfig(name="md", database="analytics").get_database_name() == "analytics"


def test_connect_builds_md_connection_string():
    """connect() routes through the DuckDB backend with an md: path."""
    cfg = MotherDuckConfig(name="md", database="analytics", read_only=True)
    with patch("ibis.duckdb.connect") as mock_connect, patch("nao_core.deps.require_database_backend"):
        cfg.connect()
    mock_connect.assert_called_once_with(database="md:analytics", read_only=True)


def test_connect_without_database_uses_default():
    cfg = MotherDuckConfig(name="md")
    with patch("ibis.duckdb.connect") as mock_connect, patch("nao_core.deps.require_database_backend"):
        cfg.connect()
    mock_connect.assert_called_once_with(database="md:", read_only=False)


def test_connect_sets_token_env_var():
    cfg = MotherDuckConfig(name="md", token="secret-token")
    with patch("ibis.duckdb.connect"), patch("nao_core.deps.require_database_backend"):
        with patch.dict(os.environ, {}, clear=False):
            os.environ.pop("motherduck_token", None)
            cfg.connect()
            assert os.environ["motherduck_token"] == "secret-token"


def test_create_context_reuses_duckdb_context():
    cfg = MotherDuckConfig(name="md")
    ctx = cfg.create_context(MagicMock(), "main", "orders")
    assert isinstance(ctx, DuckDBDatabaseContext)
