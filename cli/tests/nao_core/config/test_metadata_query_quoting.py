from unittest.mock import MagicMock

import pytest

from nao_core.config.databases.athena import AthenaDatabaseContext
from nao_core.config.databases.bigquery import BigQueryDatabaseContext, _fetch_schema_partition_metadata
from nao_core.config.databases.clickhouse import (
    ClickHouseDatabaseContext,
    _show_create_dictionary,
    _show_create_table,
)
from nao_core.config.databases.databricks import DatabricksDatabaseContext, _get_databricks_partition_columns
from nao_core.config.databases.duckdb import DuckDBDatabaseContext
from nao_core.config.databases.mysql import MysqlDatabaseContext
from nao_core.config.databases.postgres import PostgresDatabaseContext
from nao_core.config.databases.redshift import RedshiftDatabaseContext
from nao_core.config.databases.snowflake import (
    SnowflakeConfig,
    SnowflakeDatabaseContext,
    _get_snowflake_clustering_columns,
)
from nao_core.config.databases.trino import TrinoDatabaseContext


def _connection() -> MagicMock:
    conn = MagicMock()
    conn.raw_sql.return_value.fetchone.return_value = None
    conn.raw_sql.return_value.fetchall.return_value = []
    return conn


def _queries(conn: MagicMock) -> list[str]:
    return [call.args[0] for call in conn.raw_sql.call_args_list]


METADATA_CASES = [
    pytest.param(MysqlDatabaseContext, ("description", "_fetch_column_descriptions"), True, None, 2, id="mysql"),
    pytest.param(
        DatabricksDatabaseContext, ("description", "_fetch_column_descriptions"), True, "partition", 3, id="databricks"
    ),
    pytest.param(DuckDBDatabaseContext, ("description", "_fetch_column_descriptions"), False, None, 2, id="duckdb"),
    pytest.param(PostgresDatabaseContext, ("description", "_fetch_column_descriptions"), False, None, 2, id="postgres"),
    pytest.param(RedshiftDatabaseContext, ("columns",), False, None, 2, id="redshift"),
    pytest.param(
        SnowflakeDatabaseContext, ("description", "_fetch_column_descriptions"), True, "clustering", 3, id="snowflake"
    ),
    pytest.param(TrinoDatabaseContext, ("description",), False, None, 1, id="trino"),
]


@pytest.mark.parametrize("context_cls,methods,escape_backslash,extra,query_count", METADATA_CASES)
def test_metadata_queries_escape_schema_and_table_literals(context_cls, methods, escape_backslash, extra, query_count):
    conn = _connection()
    conn.current_catalog = "catalog"
    if escape_backslash:
        schema, table = r"pub\'lic", r"or\'ders"
        schema_literal, table_literal = r"'pub\\''lic'", r"'or\\''ders'"
    else:
        schema, table = "pub'lic", "or'ders"
        schema_literal, table_literal = r"'pub''lic'", r"'or''ders'"
    context = context_cls(conn, schema, table)
    for method in methods:
        getattr(context, method)()
    if extra == "partition":
        _get_databricks_partition_columns(conn, schema, table)
    elif extra == "clustering":
        _get_snowflake_clustering_columns(conn, schema, table)

    queries = _queries(conn)
    assert len(queries) == query_count
    for query in queries:
        assert schema_literal in query
        assert table_literal in query


def test_snowflake_semantic_view_queries_escape_schema_and_view_literals():
    conn = _connection()
    first_cursor = MagicMock()
    first_cursor.fetchall.return_value = [(r"v\'iew", "comment")]
    second_cursor = MagicMock()
    second_cursor.fetchone.return_value = ("CREATE VIEW",)
    conn.raw_sql.side_effect = [first_cursor, second_cursor]
    config = SnowflakeConfig(name="test", username="user", account_id="account", database="db")

    config.get_semantic_views(conn, r"sch\'ema")

    queries = _queries(conn)
    assert '"SCHEMA" = ' + r"'sch\\''ema'" in queries[0]
    assert r"GET_DDL('SEMANTIC VIEW', 'sch\\''ema.v\\''iew')" in queries[1]


ANSI_IDENTIFIERS = ('pub"lic', 'or"ders', 'col"umn', '"pub""lic"."or""ders"', '"col""umn"')
BACKTICK_IDENTIFIERS = ("pub`lic", "or`ders", "col`umn", "`pub``lic`.`or``ders`", "`col``umn`")
BIGQUERY_IDENTIFIERS = ("pub`lic", "or`ders", "col`umn", r"`pub\`lic`.`or\`ders`", r"`col\`umn`")
IDENTIFIER_CASES = [
    pytest.param(AthenaDatabaseContext, *ANSI_IDENTIFIERS, None, id="athena"),
    pytest.param(PostgresDatabaseContext, *ANSI_IDENTIFIERS, None, id="postgres"),
    pytest.param(MysqlDatabaseContext, *BACKTICK_IDENTIFIERS, None, id="mysql"),
    pytest.param(DatabricksDatabaseContext, *BACKTICK_IDENTIFIERS, None, id="databricks"),
    pytest.param(BigQueryDatabaseContext, *BIGQUERY_IDENTIFIERS, "project", id="bigquery"),
]


@pytest.mark.parametrize("context_cls,schema,table,column,quoted_table,quoted_column,project_id", IDENTIFIER_CASES)
def test_context_profiling_queries_escape_dialect_identifiers(
    context_cls, schema, table, column, quoted_table, quoted_column, project_id, monkeypatch
):
    conn = _connection()
    if project_id is None:
        context = context_cls(conn, schema, table)
    else:
        context = context_cls(conn, schema, table, project_id)
    monkeypatch.setattr(context, "_partition_filter", lambda: "")
    query = context._build_profiling_query({"name": column, "type": "string"})

    assert f"FROM {quoted_table}" in query
    assert quoted_column in query


def test_bigquery_metadata_and_preview_queries_escape_config_names(monkeypatch):
    conn = _connection()
    conn.raw_sql.side_effect = [[(7,)], [(["20260101"],)], [("ds", "DATE")], []]
    conn.table.return_value.schema.return_value = {"id": "INT64"}
    context = BigQueryDatabaseContext(conn, "sch`ema", r"or\'ders", "project")
    monkeypatch.setattr(context, "is_partitioned", lambda: True)

    assert context.row_count() == 7
    context._fetch_safe_partition_filter()
    context._run_filtered_preview("TRUE", 2)

    queries = _queries(conn)
    assert len(queries) == 4
    assert r"FROM `project.sch\`ema.INFORMATION_SCHEMA.PARTITIONS`" in queries[0]
    assert r"FROM `project.sch\`ema.INFORMATION_SCHEMA.PARTITIONS`" in queries[1]
    assert r"FROM `project.sch\`ema.INFORMATION_SCHEMA.COLUMNS`" in queries[2]
    assert r"FROM `project.sch\`ema.or\\'ders` WHERE TRUE LIMIT 2" in queries[3]
    for query in queries[:3]:
        assert r"table_name = 'or\\\'ders'" in query


def test_bigquery_batch_metadata_queries_escape_schema_path():
    conn = _connection()

    _fetch_schema_partition_metadata(conn, "project", "sch`ema")

    queries = _queries(conn)
    assert len(queries) == 4
    assert sum("INFORMATION_SCHEMA.COLUMNS" in query for query in queries) == 2
    assert any(r"FROM `project.sch\`ema.INFORMATION_SCHEMA.PARTITIONS`" in query for query in queries)
    assert any(r"FROM `project.sch\`ema.INFORMATION_SCHEMA.TABLE_OPTIONS`" in query for query in queries)


def test_clickhouse_queries_escape_quoted_identifiers():
    conn = _connection()
    conn.raw_sql.return_value.result_rows = []
    conn.raw_sql.return_value.column_names = []
    conn.table.return_value.schema.return_value = {"id": "Int64"}

    _show_create_table(conn, "sch`ema", "or`ders")
    _show_create_dictionary(conn, "sch`ema", "or`ders")
    ClickHouseDatabaseContext(conn, "sch`ema", "or`ders").preview(2)

    queries = _queries(conn)
    assert queries[:2] == [
        "SHOW CREATE TABLE `sch``ema`.`or``ders`",
        "SHOW CREATE DICTIONARY `sch``ema`.`or``ders`",
    ]
    assert "FROM `sch``ema`.`or``ders` LIMIT 2" in queries[-1]
