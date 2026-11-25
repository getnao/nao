from typing import Any
from unittest.mock import MagicMock

import pandas as pd
import pytest

from nao_core.config.databases.snowflake import SnowflakeAuthMode, SnowflakeConfig


@pytest.mark.parametrize(
    ("auth_mode", "expected"),
    [(SnowflakeAuthMode.CREDENTIALS, False), (SnowflakeAuthMode.EXTERNAL_OAUTH, True)],
)
def test_requires_user_access_token_only_in_external_oauth_mode(auth_mode: SnowflakeAuthMode, expected: bool):
    assert _snowflake_config(auth_mode=auth_mode).requires_user_access_token() is expected


def test_external_oauth_refuses_queries_with_the_configured_account():
    config = _snowflake_config(auth_mode=SnowflakeAuthMode.EXTERNAL_OAUTH)

    with pytest.raises(RuntimeError, match="external_oauth"):
        config.execute_sql("SELECT 1")


def test_connect_uses_configured_role(monkeypatch: pytest.MonkeyPatch):
    connect = _mock_snowflake_connect(monkeypatch, pd.DataFrame())
    config = _snowflake_config(
        private_key=None,
        password="secret",
        role="ANALYTICS_READER",
    )

    config.connect()

    connect.assert_called_once_with(
        user="NAO_SYNC",
        account="xy12345.us-east-1",
        role="ANALYTICS_READER",
        database="ANALYTICS",
        password="secret",
        create_object_udfs=False,
    )


def test_execute_sql_with_token_connects_as_the_token_user(monkeypatch: pytest.MonkeyPatch):
    connect = _mock_snowflake_connect(monkeypatch, pd.DataFrame([{"value": 1}]))
    config = _snowflake_config(
        auth_mode=SnowflakeAuthMode.EXTERNAL_OAUTH,
        role="ANALYTICS_READER",
        warehouse="COMPUTE_WH",
    )

    result = config.execute_sql_with_token("SELECT 1 AS value", "user-token")

    assert result.to_dict(orient="records") == [{"value": 1}]
    connect.assert_called_once_with(
        account="xy12345.us-east-1",
        database="ANALYTICS",
        role="ANALYTICS_READER",
        warehouse="COMPUTE_WH",
        authenticator="oauth",
        token="user-token",
        create_object_udfs=False,
    )
    connect.return_value.raw_sql.assert_called_once_with("SELECT 1 AS value")
    connect.return_value.disconnect.assert_called_once()


def _mock_snowflake_connect(monkeypatch: pytest.MonkeyPatch, result: pd.DataFrame) -> MagicMock:
    import ibis

    monkeypatch.setattr("nao_core.deps.require_database_backend", lambda *args, **kwargs: None)
    connect = MagicMock()
    connect.return_value.raw_sql.return_value.fetchdf.return_value = result
    monkeypatch.setattr(ibis.snowflake, "connect", connect, raising=False)
    return connect


def _snowflake_config(**overrides: Any) -> SnowflakeConfig:
    fields: dict[str, Any] = {
        "name": "sf",
        "username": "NAO_SYNC",
        "account_id": "xy12345.us-east-1",
        "database": "ANALYTICS",
        "private_key": "unused",
        **overrides,
    }
    return SnowflakeConfig(**fields)
