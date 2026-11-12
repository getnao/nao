from typing import Any
from unittest.mock import MagicMock

import pytest

from nao_core.config.databases.redshift import RedshiftConfig, RedshiftDatabaseContext, _RedshiftBackend


def test_get_schemas_uses_datashare_visible_catalog_view():
    cfg = _redshift_config()
    conn = MagicMock()
    conn.raw_sql.return_value.fetchall.return_value = [("marts",), ("public",)]

    schemas = cfg.get_schemas(conn)

    assert schemas == ["marts", "public"]
    sql = " ".join(conn.raw_sql.call_args.args[0].split())
    assert sql.startswith("SELECT DISTINCT schema_name FROM svv_all_schemas")
    assert "schema_name NOT LIKE 'pg_%'" in sql
    assert "schema_name != 'information_schema'" in sql
    assert "database_name = current_database()" in sql
    assert sql.endswith("ORDER BY schema_name")


def test_get_schemas_returns_configured_schema_without_querying():
    cfg = _redshift_config(schema_name="marts")
    conn = MagicMock()

    schemas = cfg.get_schemas(conn)

    assert schemas == ["marts"]
    conn.raw_sql.assert_not_called()


class TestRedshiftClusteringColumns:
    def _make_context(self) -> tuple[RedshiftDatabaseContext, MagicMock]:
        conn = MagicMock()
        ctx = RedshiftDatabaseContext(conn, "public", "orders")
        return ctx, conn

    def test_returns_sortkey_columns_in_order(self):
        ctx, conn = self._make_context()
        conn.raw_sql.return_value.fetchall.return_value = [("customer_id",), ("created_at",)]

        cols = ctx.clustering_columns()

        assert cols == ["customer_id", "created_at"]
        sql = conn.raw_sql.call_args[0][0]
        assert "attsortkeyord" in sql
        assert "public" in sql
        assert "orders" in sql

    def test_returns_empty_when_no_sortkeys(self):
        ctx, conn = self._make_context()
        conn.raw_sql.return_value.fetchall.return_value = []

        assert ctx.clustering_columns() == []

    def test_returns_empty_on_query_failure(self):
        ctx, conn = self._make_context()
        conn.raw_sql.side_effect = Exception("permission denied")

        assert ctx.clustering_columns() == []

    def test_escapes_single_quotes_in_identifiers(self):
        conn = MagicMock()
        ctx = RedshiftDatabaseContext(conn, "pub'lic", "or'ders")
        conn.raw_sql.return_value.fetchall.return_value = []

        ctx.clustering_columns()

        sql = conn.raw_sql.call_args[0][0]
        assert "'pub''lic'" in sql
        assert "'or''ders'" in sql


class TestRedshiftBackendListTables:
    def test_adds_datashare_tables_to_local_tables(self):
        backend = _catalog_backend({"svv_all_tables": [("orders",), ("shared_payments",), ("shared_accounts",)]})
        backend.list_tables.return_value = ["orders"]

        tables = _RedshiftBackend(backend).list_tables(database="marts")

        assert tables == ["orders", "shared_accounts", "shared_payments"]
        sql = _sql_containing(backend, "svv_all_tables")
        assert "schema_name = 'marts'" in sql
        assert "database_name = current_database()" in sql

    def test_keeps_local_tables_when_catalog_view_fails(self):
        backend = MagicMock()
        backend.list_tables.return_value = ["orders"]
        backend.raw_sql.side_effect = Exception("permission denied for svv_all_tables")

        assert _RedshiftBackend(backend).list_tables(database="marts") == ["orders"]

    def test_delegates_other_attributes(self):
        backend = MagicMock()

        _RedshiftBackend(backend).disconnect()

        backend.disconnect.assert_called_once()


class TestRedshiftDatashareColumns:
    @pytest.mark.parametrize(
        ("local_rows", "all_rows", "expected"),
        [
            (
                [("id", "integer", "NO", None, 32, 0)],
                [("ignored", "integer", "NO", None, 32, 0, None)],
                [("id", "int32 NOT NULL", None)],
            ),
            (
                [],
                [("amount", "double precision", "YES", None, 53, None, "Amount in cents ")],
                [("amount", "float64", "Amount in cents")],
            ),
        ],
        ids=["local_catalog", "datashare_fallback"],
    )
    def test_reads_columns_from_the_catalog_that_sees_the_table(self, local_rows, all_rows, expected):
        conn = _catalog_backend({"information_schema.columns": local_rows, "svv_all_columns": all_rows})
        ctx = RedshiftDatabaseContext(conn, "marts", "payments")

        columns = ctx.columns()

        assert [(col["name"], col["type"], col["description"]) for col in columns] == expected

    def test_table_description_falls_back_to_datashare_remarks(self):
        conn = _catalog_backend({"pg_catalog.pg_description": [], "svv_all_tables": [("Payments shared by finance",)]})
        ctx = RedshiftDatabaseContext(conn, "marts", "payments")

        assert ctx.description() == "Payments shared by finance"


def _catalog_backend(rows_by_source: dict[str, list[tuple]]) -> MagicMock:
    """A connection whose raw_sql returns the rows of the first catalog named in the query."""
    conn = MagicMock()

    def raw_sql(query: str) -> MagicMock:
        rows = next((rows for source, rows in rows_by_source.items() if source in query), [])
        result = MagicMock()
        result.fetchall.return_value = rows
        result.fetchone.return_value = rows[0] if rows else None
        return result

    conn.raw_sql.side_effect = raw_sql
    return conn


def _sql_containing(conn: MagicMock, fragment: str) -> str:
    queries = [" ".join(call.args[0].split()) for call in conn.raw_sql.call_args_list]
    return next(query for query in queries if fragment in query)


def _redshift_config(**overrides: Any) -> RedshiftConfig:
    fields: dict[str, Any] = {
        "name": "rs",
        "host": "redshift.example",
        "database": "analytics",
        "user": "alice",
        "password": "secret",
        **overrides,
    }
    return RedshiftConfig(**fields)
