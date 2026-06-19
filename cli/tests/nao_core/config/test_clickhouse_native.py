"""Unit tests for the native (TCP) ClickHouse backend shim."""

from __future__ import annotations

from unittest.mock import MagicMock, patch

from nao_core.config.databases._clickhouse_native import (
    NativeClickHouseBackend,
    _NativeColumnType,
    _NativeRawSQLResult,
    _NativeSchema,
    _quote_identifier,
)


class TestQuoteIdentifier:
    def test_plain_identifier_is_backtick_wrapped(self) -> None:
        assert _quote_identifier("users") == "`users`"

    def test_embedded_backticks_are_doubled(self) -> None:
        assert _quote_identifier("we`ird") == "`we``ird`"


class TestNativeColumnType:
    def test_str_returns_native_clickhouse_type(self) -> None:
        dtype = _NativeColumnType("UInt32")
        assert str(dtype) == "UInt32"

    def test_nullable_detected_from_clickhouse_type(self) -> None:
        assert _NativeColumnType("Nullable(String)").nullable is True
        assert _NativeColumnType("String").nullable is False
        assert _NativeColumnType("LowCardinality(String)").nullable is False


class TestNativeSchema:
    def test_items_and_iter_match_columns(self) -> None:
        schema = _NativeSchema([("id", "UInt32"), ("email", "Nullable(String)")])
        names = [name for name, _ in schema.items()]
        assert names == ["id", "email"]
        # __iter__ yields names (consumed by ``[f"`{name}`" for name in schema]``)
        assert list(schema) == ["id", "email"]
        assert len(schema) == 2

    def test_values_returns_dtypes(self) -> None:
        schema = _NativeSchema([("id", "UInt32"), ("amount", "Float64")])
        dtype_strs = [str(d) for d in schema.values()]
        assert dtype_strs == ["UInt32", "Float64"]


class TestNativeRawSQLResult:
    def test_exposes_clickhouse_connect_attributes(self) -> None:
        result = _NativeRawSQLResult(
            rows=[(1, "a"), (2, "b")],
            columns=[("id", "UInt32"), ("name", "String")],
        )
        assert result.result_rows == [(1, "a"), (2, "b")]
        assert result.column_names == ["id", "name"]

    def test_db_api_fetch_methods(self) -> None:
        result = _NativeRawSQLResult(
            rows=[(1, "a"), (2, "b")],
            columns=[("id", "UInt32"), ("name", "String")],
        )
        assert result.fetchone() == (1, "a")
        assert result.fetchall() == [(2, "b")]
        assert result.fetchone() is None
        # description must be a 7-tuple per column (DB-API 2.0 shape).
        assert all(len(d) == 7 for d in result.description)
        assert [d[0] for d in result.description] == ["id", "name"]


class TestNativeClickHouseBackend:
    """Verify the shim mimics the slice of the Ibis API ``nao`` relies on."""

    def _backend(self, mock_client: MagicMock) -> NativeClickHouseBackend:
        with patch("clickhouse_driver.Client", return_value=mock_client):
            return NativeClickHouseBackend(
                host="ch",
                port=9000,
                database="default",
                user="default",
                password="",
                secure=False,
            )

    def test_list_databases(self) -> None:
        client = MagicMock()
        client.execute.return_value = [("default",), ("system",)]
        backend = self._backend(client)
        assert backend.list_databases() == ["default", "system"]
        sql = client.execute.call_args.args[0]
        assert "system.databases" in sql

    def test_list_tables_scopes_to_database(self) -> None:
        client = MagicMock()
        client.execute.return_value = [("users",), ("orders",)]
        backend = self._backend(client)
        assert backend.list_tables(database="analytics") == ["users", "orders"]
        sql, params = client.execute.call_args.args[0], client.execute.call_args.args[1]
        assert "system.tables" in sql
        assert params == {"db": "analytics"}

    def test_raw_sql_returns_clickhouse_connect_like_result(self) -> None:
        client = MagicMock()
        client.execute.return_value = (
            [(1, "a"), (2, "b")],
            [("id", "UInt32"), ("name", "String")],
        )
        backend = self._backend(client)
        result = backend.raw_sql("SELECT id, name FROM users")
        assert result.result_rows == [(1, "a"), (2, "b")]
        assert result.column_names == ["id", "name"]
        client.execute.assert_called_once_with("SELECT id, name FROM users", with_column_types=True)

    def test_raw_sql_handles_ddl_with_no_columns(self) -> None:
        """DDL statements yield ``([], None)``; the shim normalises that to empty result."""
        client = MagicMock()
        client.execute.return_value = ([], None)
        backend = self._backend(client)
        result = backend.raw_sql("CREATE TABLE t (id UInt32) ENGINE = MergeTree() ORDER BY id")
        assert result.result_rows == []
        assert result.column_names == []

    def test_table_schema_uses_describe(self) -> None:
        client = MagicMock()
        client.execute.return_value = (
            [
                ("id", "UInt32", "", "", "", "", ""),
                ("name", "Nullable(String)", "", "", "", "", ""),
            ],
            [],
        )
        backend = self._backend(client)
        schema = backend.table("users", database="analytics").schema()
        client.execute.assert_called_with("DESCRIBE TABLE `analytics`.`users`", with_column_types=True)
        items = list(schema.items())
        assert [name for name, _ in items] == ["id", "name"]
        assert [str(dtype) for _, dtype in items] == ["UInt32", "Nullable(String)"]
        assert items[1][1].nullable is True

    def test_table_count_executes_count_query(self) -> None:
        client = MagicMock()
        client.execute.return_value = [(42,)]
        backend = self._backend(client)
        result = backend.table("users", database="analytics").count().execute()
        assert result == 42
        client.execute.assert_called_with("SELECT count() FROM `analytics`.`users`")

    def test_table_count_empty_returns_zero(self) -> None:
        client = MagicMock()
        client.execute.return_value = []
        backend = self._backend(client)
        assert backend.table("users").count().execute() == 0

    def test_table_schema_escapes_backticks_in_identifiers(self) -> None:
        client = MagicMock()
        client.execute.return_value = ([], [])
        backend = self._backend(client)
        backend.table("we`ird", database="da`ta").schema()
        client.execute.assert_called_with("DESCRIBE TABLE `da``ta`.`we``ird`", with_column_types=True)

    def test_table_count_escapes_backticks_in_identifiers(self) -> None:
        client = MagicMock()
        client.execute.return_value = [(7,)]
        backend = self._backend(client)
        assert backend.table("we`ird", database="da`ta").count().execute() == 7
        client.execute.assert_called_with("SELECT count() FROM `da``ta`.`we``ird`")

    def test_disconnect_is_idempotent_on_errors(self) -> None:
        client = MagicMock()
        client.disconnect.side_effect = RuntimeError("already disconnected")
        backend = self._backend(client)
        backend.disconnect()
        client.disconnect.assert_called_once()
