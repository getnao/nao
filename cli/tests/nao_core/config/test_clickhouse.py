"""Unit tests for the ClickHouse database config (focused on protocol dispatch)."""

from __future__ import annotations

from typing import Any
from unittest.mock import MagicMock, patch

import pytest

from nao_core.config.databases.clickhouse import ClickHouseConfig, ClickHouseDatabaseContext


def _base_config(**overrides: Any) -> ClickHouseConfig:
    base: dict[str, Any] = {
        "name": "ch",
        "host": "ch.example",
        "database": "default",
        "user": "default",
        "password": "",
    }
    base.update(overrides)
    return ClickHouseConfig(**base)


def test_columns_retries_after_failed_load() -> None:
    context = ClickHouseDatabaseContext(MagicMock(), "default", "events")
    columns = [{"name": "id", "type": "UInt64"}]

    with patch.object(context, "_load_columns", side_effect=[None, columns]) as load_columns:
        assert context.columns() == []
        assert context._columns_cache is None
        assert context._columns_load_failed is True
        assert context.columns() == columns

    assert load_columns.call_count == 2


def test_columns_caches_successful_empty_load() -> None:
    context = ClickHouseDatabaseContext(MagicMock(), "default", "events")

    with patch.object(context, "_load_columns", return_value=[]) as load_columns:
        assert context.columns() == []
        assert context.columns() == []

    assert context._columns_cache == []
    assert context._columns_load_failed is False
    load_columns.assert_called_once()


class TestProtocolField:
    def test_defaults_to_http(self) -> None:
        config = _base_config()
        assert config.protocol == "http"

    def test_native_protocol_is_accepted(self) -> None:
        config = _base_config(protocol="native")
        assert config.protocol == "native"

    def test_rejects_unknown_protocol(self) -> None:
        with pytest.raises(ValueError):
            _base_config(protocol="ftp")


class TestConnectDispatch:
    def test_http_protocol_uses_ibis(self) -> None:
        """Default protocol must still go through ``ibis.clickhouse.connect``."""
        config = _base_config()
        mock_backend = MagicMock(name="ibis_backend")
        with patch("nao_core.deps.require_database_backend") as mock_require:
            with patch("ibis.clickhouse") as mock_ibis_ch:
                mock_ibis_ch.connect.return_value = mock_backend
                conn = config.connect()
        mock_require.assert_called_once_with("clickhouse")
        mock_ibis_ch.connect.assert_called_once()
        assert conn is mock_backend

    def test_native_protocol_uses_native_backend(self) -> None:
        """Native protocol must build a ``NativeClickHouseBackend`` instead of Ibis."""
        config = _base_config(protocol="native", port=9000)
        with patch("nao_core.deps.require_dependency") as mock_require:
            with patch("nao_core.config.databases._clickhouse_native.NativeClickHouseBackend") as mock_native_cls:
                conn = config.connect()
        mock_require.assert_called_once()
        # Ibis must NOT be invoked when protocol="native".
        mock_native_cls.assert_called_once()
        kwargs = mock_native_cls.call_args.kwargs
        assert kwargs["host"] == "ch.example"
        assert kwargs["port"] == 9000
        assert kwargs["database"] == "default"
        assert kwargs["secure"] is False
        assert kwargs["verify"] is True
        assert conn is mock_native_cls.return_value

    def test_native_protocol_propagates_timeouts(self) -> None:
        config = _base_config(
            protocol="native",
            connect_timeout=15,
            send_receive_timeout=60,
            secure=True,
            verify=False,
        )
        with patch("nao_core.deps.require_dependency"):
            with patch("nao_core.config.databases._clickhouse_native.NativeClickHouseBackend") as mock_native_cls:
                config.connect()
        kwargs = mock_native_cls.call_args.kwargs
        assert kwargs["connect_timeout"] == 15
        assert kwargs["send_receive_timeout"] == 60
        assert kwargs["secure"] is True
        assert kwargs["verify"] is False
