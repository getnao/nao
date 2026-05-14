"""Unit tests for Trino database config."""

from unittest.mock import MagicMock, patch

import pytest
from trino.auth import BasicAuthentication

from nao_core.config.databases.trino import TrinoConfig


@pytest.fixture
def base_config() -> TrinoConfig:
    return TrinoConfig(
        name="t",
        host="trino.example",
        port=8080,
        catalog="hive",
        user="alice",
        password=None,
        schema_name=None,
    )


def test_connect_passes_user_without_password(base_config: TrinoConfig) -> None:
    mock_connect = MagicMock()
    with (
        patch("nao_core.deps.require_database_backend"),
        patch("ibis.trino.connect", mock_connect),
    ):
        base_config.connect()

    mock_connect.assert_called_once()
    call_kw = mock_connect.call_args.kwargs
    assert call_kw["host"] == "trino.example"
    assert call_kw["port"] == 8080
    assert call_kw["user"] == "alice"
    assert call_kw["database"] == "hive"
    assert "auth" not in call_kw


def test_connect_uses_basic_auth_when_password_set(base_config: TrinoConfig) -> None:
    mock_connect = MagicMock()
    cfg = base_config.model_copy(update={"password": "secret"})
    with (
        patch("nao_core.deps.require_database_backend"),
        patch("ibis.trino.connect", mock_connect),
    ):
        cfg.connect()

    mock_connect.assert_called_once()
    call_kw = mock_connect.call_args.kwargs
    assert call_kw["user"] == "alice"
    assert "password" not in call_kw
    auth = call_kw.get("auth")
    assert isinstance(auth, BasicAuthentication)


def test_connect_includes_schema_when_set(base_config: TrinoConfig) -> None:
    mock_connect = MagicMock()
    cfg = base_config.model_copy(update={"schema_name": "analytics"})
    with (
        patch("nao_core.deps.require_database_backend"),
        patch("ibis.trino.connect", mock_connect),
    ):
        cfg.connect()

    assert mock_connect.call_args.kwargs["schema"] == "analytics"
