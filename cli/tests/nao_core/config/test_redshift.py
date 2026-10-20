from typing import Any
from unittest.mock import MagicMock

from nao_core.config.databases.redshift import RedshiftConfig, RedshiftDatabaseContext


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
