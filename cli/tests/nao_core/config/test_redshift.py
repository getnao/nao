from unittest.mock import MagicMock

from nao_core.config.databases.redshift import RedshiftConfig


def test_get_schemas_uses_datashare_visible_catalog_view():
    cfg = RedshiftConfig(
        name="rs",
        host="redshift.example",
        database="analytics",
        user="alice",
        password="secret",
    )
    conn = MagicMock()
    cursor = MagicMock()
    cursor.fetchall.return_value = [("marts",), ("public",)]
    conn.raw_sql.return_value = cursor

    schemas = cfg.get_schemas(conn)

    assert schemas == ["marts", "public"]
    sql = " ".join(conn.raw_sql.call_args.args[0].split())
    assert sql.startswith("SELECT DISTINCT schema_name FROM svv_all_schemas")
    assert "schema_name NOT LIKE 'pg_%'" in sql
    assert "schema_name != 'information_schema'" in sql
    assert "database_name = current_database()" in sql
    assert sql.endswith("ORDER BY schema_name")


def test_get_schemas_returns_configured_schema_without_querying():
    cfg = RedshiftConfig(
        name="rs",
        host="redshift.example",
        database="analytics",
        user="alice",
        password="secret",
        schema_name="marts",
    )
    conn = MagicMock()

    schemas = cfg.get_schemas(conn)

    assert schemas == ["marts"]
    conn.raw_sql.assert_not_called()
