"""Unit tests for the ClickHouse database config (focused on protocol dispatch)."""

from __future__ import annotations

import logging
from types import ModuleType
from typing import Any
from unittest.mock import MagicMock, patch

import pytest

from nao_core.config.databases.clickhouse import (
    ClickHouseConfig,
    ClickHouseDatabaseContext,
    _column_metadata,
    _columns_from_describe,
    _is_server_settings_probe,
    _RestrictedDiscoveryBackend,
    _server_settings_probe_optional,
)


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


# The query clickhouse-connect runs while constructing a client, unchanged from 0.14 to 1.6.
SERVER_SETTINGS_PROBE = "SELECT name, value, readonly as readonly FROM system.settings LIMIT 10000"

# Tinybird's response when a non-ADMIN token reads a Service Data Source.
TINYBIRD_FORBIDDEN = (
    "HTTP driver received HTTP status 403, server response: Services Data Sources like "
    "'system.settings' can't be directly accessed without an ADMIN token."
)


class TestServerSettingsProbe:
    """Servers that refuse system.settings (Tinybird) must still be connectable."""

    def test_probe_is_recognised(self) -> None:
        assert _is_server_settings_probe(SERVER_SETTINGS_PROBE)

    def test_probe_is_recognised_with_literal_readonly_value(self) -> None:
        """Pre-19.17 servers get the readonly value inlined instead of the column name."""
        assert _is_server_settings_probe("SELECT name, value, 0 as readonly FROM system.settings LIMIT 10000")

    def test_user_query_on_system_settings_is_not_the_probe(self) -> None:
        """A user's own system.settings query must keep raising rather than come back empty."""
        assert not _is_server_settings_probe("SELECT name, value FROM system.settings WHERE name = 'max_threads'")
        assert not _is_server_settings_probe("SELECT * FROM system.settings")

    def test_forbidden_probe_falls_back_to_no_settings(self) -> None:
        client_cls = _fake_http_client_class(raise_on=SERVER_SETTINGS_PROBE)
        with patch.dict("sys.modules", {"clickhouse_connect.driver.httpclient": _module(HttpClient=client_cls)}):
            with _server_settings_probe_optional():
                result = client_cls().query(SERVER_SETTINGS_PROBE)
        assert list(result.named_results()) == []

    def test_other_failures_still_raise(self) -> None:
        client_cls = _fake_http_client_class(raise_on="SELECT 1")
        with patch.dict("sys.modules", {"clickhouse_connect.driver.httpclient": _module(HttpClient=client_cls)}):
            with _server_settings_probe_optional():
                with pytest.raises(RuntimeError):
                    client_cls().query("SELECT 1")

    def test_original_query_method_is_restored(self) -> None:
        client_cls = _fake_http_client_class(raise_on=SERVER_SETTINGS_PROBE)
        original = client_cls.query
        with patch.dict("sys.modules", {"clickhouse_connect.driver.httpclient": _module(HttpClient=client_cls)}):
            with _server_settings_probe_optional():
                assert client_cls.query is not original
        assert client_cls.query is original

    def test_probe_is_not_tolerated_by_default(self) -> None:
        assert _base_config().tolerate_unreadable_system_tables is False

    def test_error_message_names_the_option(self) -> None:
        config = _base_config()
        message = config._connection_error_message(RuntimeError(TINYBIRD_FORBIDDEN))
        assert "tolerate_unreadable_system_tables" in message

    def test_error_message_is_untouched_once_enabled(self) -> None:
        config = _base_config(tolerate_unreadable_system_tables=True)
        message = config._connection_error_message(RuntimeError(TINYBIRD_FORBIDDEN))
        assert message == TINYBIRD_FORBIDDEN

    def test_unrelated_error_is_untouched(self) -> None:
        config = _base_config()
        assert config._connection_error_message(RuntimeError("connection refused")) == "connection refused"


class TestRestrictedDiscovery:
    """When the system database is unreadable, discovery comes from `include`."""

    def test_include_targets_group_tables_by_schema(self) -> None:
        config = _base_config(include=["analytics.users", "analytics.orders", "telemetry.events"])
        targets, unexpandable = config._include_targets()
        assert targets == {"analytics": ["users", "orders"], "telemetry": ["events"]}
        assert unexpandable == []

    def test_wildcards_and_bare_schemas_are_reported_not_silently_dropped(self) -> None:
        """A pattern cannot be expanded without the listing that is unavailable."""
        config = _base_config(include=["analytics.*", "analytics", "analytics.users", "logs.evt_?"])
        targets, unexpandable = config._include_targets()
        assert targets == {"analytics": ["users"]}
        assert unexpandable == ["analytics.*", "analytics", "logs.evt_?"]

    def test_unexpandable_patterns_are_logged_once(self, caplog: pytest.LogCaptureFixture) -> None:
        backend = MagicMock(name="backend")
        backend.list_tables.side_effect = RuntimeError(TINYBIRD_FORBIDDEN)
        wrapped = _RestrictedDiscoveryBackend(backend, {"analytics": ["users"]}, ["analytics.*"])
        with caplog.at_level(logging.WARNING):
            wrapped.list_tables(database="analytics")
            wrapped.list_tables(database="analytics")
        assert sum("analytics.*" in record.getMessage() for record in caplog.records) == 1

    def test_all_wildcard_include_is_reported_when_databases_are_denied(self, caplog: pytest.LogCaptureFixture) -> None:
        """With no explicit targets, list_tables is never reached, so list_databases must warn."""
        backend = MagicMock(name="backend")
        backend.list_databases.side_effect = RuntimeError(TINYBIRD_FORBIDDEN)
        wrapped = _RestrictedDiscoveryBackend(backend, {}, ["analytics.*"])
        with caplog.at_level(logging.WARNING):
            assert wrapped.list_databases() == []
        assert any("analytics.*" in record.getMessage() for record in caplog.records)

    def test_listings_pass_through_when_the_server_allows_them(self) -> None:
        backend = MagicMock(name="backend")
        backend.list_databases.return_value = ["analytics"]
        backend.list_tables.return_value = ["users", "orders", "audit"]
        wrapped = _RestrictedDiscoveryBackend(backend, {"analytics": ["users"]})
        assert wrapped.list_databases() == ["analytics"]
        assert wrapped.list_tables(database="analytics") == ["users", "orders", "audit"]

    def test_blocked_listings_fall_back_to_include(self) -> None:
        backend = MagicMock(name="backend")
        backend.list_databases.side_effect = RuntimeError(TINYBIRD_FORBIDDEN)
        backend.list_tables.side_effect = RuntimeError(TINYBIRD_FORBIDDEN)
        wrapped = _RestrictedDiscoveryBackend(backend, {"analytics": ["users", "orders"]})
        assert wrapped.list_databases() == ["analytics"]
        assert wrapped.list_tables(database="analytics") == ["users", "orders"]

    def test_blocked_listing_for_unknown_schema_is_empty(self) -> None:
        backend = MagicMock(name="backend")
        backend.list_tables.side_effect = RuntimeError(TINYBIRD_FORBIDDEN)
        wrapped = _RestrictedDiscoveryBackend(backend, {"analytics": ["users"]})
        assert wrapped.list_tables(database="somewhere_else") == []

    def test_everything_else_is_delegated(self) -> None:
        backend = MagicMock(name="backend")
        wrapped = _RestrictedDiscoveryBackend(backend, {})
        wrapped.raw_sql("SELECT 1")
        wrapped.disconnect()
        backend.raw_sql.assert_called_once_with("SELECT 1")
        backend.disconnect.assert_called_once()

    def test_connection_is_not_wrapped_by_default(self) -> None:
        config = _base_config()
        mock_backend = MagicMock(name="ibis_backend")
        with patch("nao_core.deps.require_database_backend"):
            with patch.object(ClickHouseConfig, "_connect_http_client", return_value=mock_backend):
                assert config.connect() is mock_backend

    def test_connection_is_wrapped_when_enabled(self) -> None:
        config = _base_config(tolerate_unreadable_system_tables=True, include=["analytics.users"])
        mock_backend = MagicMock(name="ibis_backend")
        stub = _module(HttpClient=_fake_http_client_class(raise_on=SERVER_SETTINGS_PROBE))
        with patch.dict("sys.modules", {"clickhouse_connect.driver.httpclient": stub}):
            with patch("nao_core.deps.require_database_backend"):
                with patch.object(ClickHouseConfig, "_connect_http_client", return_value=mock_backend):
                    conn = config.connect()
        assert isinstance(conn, _RestrictedDiscoveryBackend)
        assert conn.raw_sql is mock_backend.raw_sql


class TestColumnMetadata:
    """DESCRIBE TABLE covers the same fields as system.columns and needs no system access."""

    def _conn(self, rows: list[dict[str, Any]] | Exception) -> MagicMock:
        conn = MagicMock(name="conn")
        cursor = MagicMock(name="cursor")
        cursor.column_names = ["name", "type", "default_type", "default_expression", "comment"]
        if isinstance(rows, Exception):
            conn.raw_sql.side_effect = rows
        else:
            cursor.result_rows = [tuple(r[c] for c in cursor.column_names) for r in rows]
            conn.raw_sql.return_value = cursor
        return conn

    def test_describe_rows_are_mapped_to_column_metadata(self) -> None:
        conn = self._conn(
            [
                {
                    "name": "id",
                    "type": "String",
                    "default_type": "",
                    "default_expression": "",
                    "comment": "primary id",
                },
                {
                    "name": "score",
                    "type": "Nullable(Float64)",
                    "default_type": "DEFAULT",
                    "default_expression": "0",
                    "comment": "",
                },
            ]
        )
        columns = _columns_from_describe(conn, "analytics", "users")
        assert columns == [
            {
                "name": "id",
                "type": "String",
                "nullable": False,
                "description": "primary id",
                "default_kind": None,
                "default_expression": None,
            },
            {
                "name": "score",
                "type": "Nullable(Float64)",
                "nullable": True,
                "description": None,
                "default_kind": "DEFAULT",
                "default_expression": "0",
            },
        ]

    def test_describe_failure_is_empty(self) -> None:
        conn = self._conn(RuntimeError("nope"))
        assert _columns_from_describe(conn, "analytics", "users") == []

    def test_backticks_in_identifiers_are_escaped(self) -> None:
        conn = MagicMock(name="conn")
        conn.raw_sql.return_value = MagicMock(result_rows=[], column_names=["name"])
        _columns_from_describe(conn, "we`ird", "ta`ble")
        assert conn.raw_sql.call_args.args[0] == "DESCRIBE TABLE `we``ird`.`ta``ble`"

    def test_system_columns_win_when_available(self) -> None:
        conn = MagicMock(name="conn")
        system_columns = [{"name": "from_system", "type": "String"}]
        with patch("nao_core.config.databases.clickhouse._columns_from_system", return_value=system_columns):
            with patch("nao_core.config.databases.clickhouse._columns_from_describe") as mock_describe:
                assert _column_metadata(conn, "analytics", "users", describe_fallback=True) == system_columns
        mock_describe.assert_not_called()

    def test_describe_is_used_when_system_columns_is_empty(self) -> None:
        conn = MagicMock(name="conn")
        described = [{"name": "from_describe", "type": "String"}]
        with patch("nao_core.config.databases.clickhouse._columns_from_system", return_value=[]):
            with patch("nao_core.config.databases.clickhouse._columns_from_describe", return_value=described):
                assert _column_metadata(conn, "analytics", "users", describe_fallback=True) == described

    def test_describe_is_not_used_unless_opted_in(self) -> None:
        """With the field off, an empty system.columns must stay empty, as it was before."""
        conn = MagicMock(name="conn")
        with patch("nao_core.config.databases.clickhouse._columns_from_system", return_value=[]):
            with patch("nao_core.config.databases.clickhouse._columns_from_describe") as mock_describe:
                assert _column_metadata(conn, "analytics", "users") == []
        mock_describe.assert_not_called()

    def test_context_inherits_the_opt_in_from_config(self) -> None:
        conn = MagicMock(name="conn")
        assert _base_config().create_context(conn, "analytics", "users")._describe_fallback is False
        opted_in = _base_config(tolerate_unreadable_system_tables=True)
        assert opted_in.create_context(conn, "analytics", "users")._describe_fallback is True


def _module(**attributes: Any) -> ModuleType:
    module = ModuleType("stub")
    for name, value in attributes.items():
        setattr(module, name, value)
    return module


class _FakeHttpClient:
    """Stands in for clickhouse-connect's HttpClient, failing on one nominated query."""

    raise_on = ""

    def query(self, sql: str | None = None, *args: Any, **kwargs: Any) -> Any:
        if sql == self.raise_on:
            raise RuntimeError(TINYBIRD_FORBIDDEN)
        return MagicMock(name="query_result")


def _fake_http_client_class(raise_on: str) -> type[_FakeHttpClient]:
    return type("FakeHttpClient", (_FakeHttpClient,), {"raise_on": raise_on})
