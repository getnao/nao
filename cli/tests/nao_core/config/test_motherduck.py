from __future__ import annotations

from pathlib import Path
from typing import Any, cast
from unittest.mock import MagicMock, patch

import pytest

from nao_core.config.base import NaoConfig
from nao_core.config.databases import parse_database_config
from nao_core.config.databases.base import DatabaseType
from nao_core.config.databases.duckdb import DuckDBConfig
from nao_core.config.databases.motherduck import MotherDuckConfig, motherduck_database_path
from nao_core.deps import get_required_extras


def test_database_type_includes_motherduck() -> None:
    assert DatabaseType.MOTHERDUCK.value == "motherduck"
    labels = {choice.title: choice.value for choice in DatabaseType.choices()}
    assert labels["MotherDuck"] == "motherduck"
    assert labels["DuckDB"] == "duckdb"


def test_motherduck_database_path_variants() -> None:
    assert motherduck_database_path() == "md:"
    assert motherduck_database_path("my_db") == "md:my_db"
    assert motherduck_database_path("my_db", "tok+en") == "md:my_db?motherduck_token=tok%2Ben"
    assert motherduck_database_path(None, "abc") == "md:?motherduck_token=abc"


def test_parse_motherduck_config() -> None:
    cfg = parse_database_config(
        {
            "type": "motherduck",
            "name": "md-analytics",
            "database": "my_db",
            "token": "secret-token",
        }
    )
    assert isinstance(cfg, MotherDuckConfig)
    assert cfg.type == "motherduck"
    assert cfg.database == "my_db"
    assert cfg.token == "secret-token"
    assert cfg.connection_path() == "md:my_db?motherduck_token=secret-token"
    assert cfg.get_database_name() == "my_db"


def test_parse_plain_duckdb_still_works() -> None:
    cfg = parse_database_config({"type": "duckdb", "name": "local", "path": ":memory:"})
    assert isinstance(cfg, DuckDBConfig)
    assert cfg.path == ":memory:"
    assert cfg.get_database_name() == "memory"


def test_nao_config_load_motherduck_with_env_token(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("MOTHERDUCK_TOKEN", "env-token-value")
    config_path = tmp_path / "nao_config.yaml"
    config_path.write_text(
        """
project_name: md-project
databases:
  - type: motherduck
    name: md-analytics
    database: analytics
    token: "{{ env('MOTHERDUCK_TOKEN') }}"
""".lstrip()
    )

    config = NaoConfig.load(tmp_path)
    assert len(config.databases) == 1
    db = config.databases[0]
    assert isinstance(db, MotherDuckConfig)
    assert db.token == "env-token-value"
    assert db.connection_path() == "md:analytics?motherduck_token=env-token-value"


def test_motherduck_requires_duckdb_extra() -> None:
    config = NaoConfig(
        project_name="md-project",
        databases=[MotherDuckConfig(name="md", database="my_db", token="t")],
    )
    assert get_required_extras(config) == ["duckdb"]


def test_motherduck_connect_uses_duckdb_backend_without_lockdown() -> None:
    cfg = MotherDuckConfig(name="md", database="my_db", token="tok")
    mock_conn = MagicMock()

    with (
        patch("nao_core.deps.require_database_backend") as mock_require,
        patch("ibis.duckdb.connect", return_value=mock_conn) as mock_connect,
    ):
        conn = cfg.connect()

    assert conn is mock_conn
    mock_require.assert_called_once_with("duckdb", extra="duckdb", database_type="motherduck")
    mock_connect.assert_called_once_with(
        database="md:my_db?motherduck_token=tok",
        read_only=False,
    )
    # MotherDuck must not disable external access.
    mock_conn.raw_sql.assert_not_called()


def test_duckdb_md_path_skips_lockdown() -> None:
    cfg = DuckDBConfig(name="legacy-md", path="md:my_db?motherduck_token=abc")
    mock_conn = MagicMock()

    with (
        patch("nao_core.deps.require_database_backend"),
        patch("ibis.duckdb.connect", return_value=mock_conn) as mock_connect,
    ):
        conn = cast(Any, cfg.connect())

    assert conn is mock_conn
    mock_connect.assert_called_once_with(database="md:my_db?motherduck_token=abc", read_only=False)
    mock_conn.raw_sql.assert_not_called()
    assert cfg.get_database_name() == "my_db"


def test_motherduck_prompt_config() -> None:
    with patch("nao_core.config.databases.motherduck.ask_text") as mock_ask:
        mock_ask.side_effect = ["md-prod", "analytics", "tok123"]
        cfg = MotherDuckConfig.promptConfig()

    assert cfg.name == "md-prod"
    assert cfg.database == "analytics"
    assert cfg.token == "tok123"
    assert cfg.type == "motherduck"


def test_motherduck_prompt_config_optional_fields() -> None:
    with patch("nao_core.config.databases.motherduck.ask_text") as mock_ask:
        mock_ask.side_effect = ["motherduck", "", ""]
        cfg = MotherDuckConfig.promptConfig()

    assert cfg.name == "motherduck"
    assert cfg.database is None
    assert cfg.token is None
    assert cfg.connection_path() == "md:"
