from unittest.mock import MagicMock, patch

from nao_core.config.databases.starrocks import StarRocksConfig, StarRocksDatabaseContext


class DummyConn:
    def list_catalogs(self):
        return ["default_catalog", "hive1"]

    def list_databases(self, catalog: str):
        return {
            "default_catalog": ["information_schema", "sales"],
            "hive1": ["analytics"],
        }[catalog]


def test_columns_retries_after_failed_load():
    context = StarRocksDatabaseContext(MagicMock(), "default_catalog.sales", "events")
    columns = [{"name": "id", "type": "BIGINT"}]

    with (
        patch.object(
            context,
            "_columns_from_information_schema",
            side_effect=[RuntimeError("metadata unavailable"), columns],
        ) as information_schema_columns,
        patch.object(
            context,
            "_columns_from_show_full_columns",
            side_effect=RuntimeError("fallback unavailable"),
        ) as fallback_columns,
    ):
        assert context.columns() == []
        assert context._columns_cache is None
        assert context._columns_load_failed is True
        assert context.columns() == columns

    assert information_schema_columns.call_count == 2
    assert fallback_columns.call_count == 1


def test_columns_falls_back_after_empty_information_schema():
    context = StarRocksDatabaseContext(MagicMock(), "default_catalog.sales", "events")
    columns = [{"name": "id", "type": "BIGINT"}]

    with (
        patch.object(context, "_columns_from_information_schema", return_value=[]) as information_schema_columns,
        patch.object(context, "_columns_from_show_full_columns", return_value=columns) as fallback_columns,
    ):
        assert context.columns() == columns
        assert context.columns() == columns

    assert context._columns_cache == columns
    assert context._columns_load_failed is False
    information_schema_columns.assert_called_once()
    fallback_columns.assert_called_once()


def test_columns_falls_back_after_information_schema_failure():
    context = StarRocksDatabaseContext(MagicMock(), "default_catalog.sales", "events")
    columns = [{"name": "id", "type": "BIGINT"}]

    with (
        patch.object(
            context,
            "_columns_from_information_schema",
            side_effect=RuntimeError("metadata unavailable"),
        ) as information_schema_columns,
        patch.object(context, "_columns_from_show_full_columns", return_value=columns) as fallback_columns,
    ):
        assert context.columns() == columns
        assert context.columns() == columns

    assert context._columns_cache == columns
    assert context._columns_load_failed is False
    information_schema_columns.assert_called_once()
    fallback_columns.assert_called_once()


def test_columns_caches_empty_fallback():
    context = StarRocksDatabaseContext(MagicMock(), "default_catalog.sales", "events")

    with (
        patch.object(context, "_columns_from_information_schema", return_value=[]) as information_schema_columns,
        patch.object(context, "_columns_from_show_full_columns", return_value=[]) as fallback_columns,
    ):
        assert context.columns() == []
        assert context.columns() == []

    assert context._columns_cache == []
    assert context._columns_load_failed is False
    information_schema_columns.assert_called_once()
    fallback_columns.assert_called_once()


def test_starrocks_get_schemas_without_explicit_schema():
    cfg = StarRocksConfig(name="sr", host="localhost", user="root", catalog=None)
    schemas = cfg.get_schemas(DummyConn())
    assert schemas == ["default_catalog.sales", "hive1.analytics"]


def test_starrocks_matches_pattern_accepts_catalog_and_schema_forms():
    cfg = StarRocksConfig(
        name="sr",
        host="localhost",
        user="root",
        catalog="default_catalog",
        include=["default_catalog.sales.*"],
        exclude=["sales.orders"],
    )

    assert cfg.matches_pattern("default_catalog.sales", "users") is True
    assert cfg.matches_pattern("default_catalog.sales", "orders") is False


def test_starrocks_get_database_name_variants():
    both = StarRocksConfig(name="sr", host="localhost", user="root", catalog="hive1", database="analytics")
    catalog_only = StarRocksConfig(name="sr", host="localhost", user="root", catalog="hive1")
    fallback = StarRocksConfig(name="sr", host="localhost", user="root")

    assert both.get_database_name() == "hive1.analytics"
    assert catalog_only.get_database_name() == "hive1"
    assert fallback.get_database_name() == "starrocks"
