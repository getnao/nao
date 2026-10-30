"""Unit tests for profiling query generation across warehouses."""

from unittest.mock import MagicMock

import pytest

from nao_core.config.databases.athena import AthenaDatabaseContext
from nao_core.config.databases.bigquery import BigQueryDatabaseContext, TablePartitionMetadata
from nao_core.config.databases.context import DatabaseContext
from nao_core.config.databases.databricks import DatabricksDatabaseContext
from nao_core.config.databases.mssql import MssqlDatabaseContext
from nao_core.config.databases.redshift import RedshiftDatabaseContext
from nao_core.config.databases.snowflake import SnowflakeDatabaseContext
from nao_core.config.databases.trino import TrinoDatabaseContext


def make_context(cls, schema="my_schema", table="my_table", partition_cols=None):
    conn = MagicMock()
    if cls.__name__ == "BigQueryDatabaseContext":
        ctx = cls(conn, schema, table, project_id="test-project")
    else:
        ctx = cls(conn, schema, table)
    ctx.partition_columns = MagicMock(return_value=partition_cols or [])
    return ctx


def normalize(sql: str) -> str:
    """Normalize whitespace for comparison."""
    return " ".join(sql.split())


INT_COL = {"name": "id", "type": "int32"}
STR_COL = {"name": "status", "type": "string"}
FLOAT_COL = {"name": "amount", "type": "float64"}
DATE_COL = {"name": "created_at", "type": "date"}
ARRAY_COL = {"name": "tags", "type": "array<string>"}
STRUCT_COL = {"name": "meta", "type": "struct<x: int>"}
JSON_COL = {"name": "props", "type": "json"}


class TestBaseProfilingQuery:
    def test_string_column(self):
        ctx = make_context(DatabaseContext)
        sql = ctx._build_profiling_query(STR_COL)
        expected = normalize("""
            SELECT
                COUNT(*) - COUNT("status") AS null_count,
                COUNT(DISTINCT "status") AS distinct_count
            FROM "my_schema"."my_table"
        """)
        assert normalize(sql) == expected

    def test_integer_column(self):
        ctx = make_context(DatabaseContext)
        sql = ctx._build_profiling_query(INT_COL)
        expected = normalize("""
            SELECT
                COUNT(*) - COUNT("id") AS null_count,
                COUNT(DISTINCT "id") AS distinct_count
                , MIN("id") AS col_min
                , MAX("id") AS col_max
                , AVG(CAST("id" AS DOUBLE)) AS col_mean
                , STDDEV_POP(CAST("id" AS DOUBLE)) AS col_stddev
            FROM "my_schema"."my_table"
        """)
        assert normalize(sql) == expected

    def test_float_column(self):
        ctx = make_context(DatabaseContext)
        sql = ctx._build_profiling_query(FLOAT_COL)
        expected = normalize("""
            SELECT
                COUNT(*) - COUNT("amount") AS null_count,
                COUNT(DISTINCT "amount") AS distinct_count
                , MIN("amount") AS col_min
                , MAX("amount") AS col_max
                , AVG(CAST("amount" AS DOUBLE)) AS col_mean
                , STDDEV_POP(CAST("amount" AS DOUBLE)) AS col_stddev
            FROM "my_schema"."my_table"
        """)
        assert normalize(sql) == expected

    def test_date_column(self):
        ctx = make_context(DatabaseContext)
        sql = ctx._build_profiling_query(DATE_COL)
        expected = normalize("""
            SELECT
                COUNT(*) - COUNT("created_at") AS null_count,
                COUNT(DISTINCT "created_at") AS distinct_count
                , MIN("created_at") AS col_min
                , MAX("created_at") AS col_max
            FROM "my_schema"."my_table"
        """)
        assert normalize(sql) == expected


class TestComplexTypeDetection:
    @pytest.mark.parametrize(
        "col_type",
        [
            "array<string>",
            "struct<x: int>",
            "map<string, int>",
            "json",
            "row(x int)",
            "tuple(string, int)",
            "variant",
            "object",
            "super",
        ],
    )
    def test_is_complex(self, col_type):
        assert DatabaseContext._is_complex_type_column({"type": col_type})

    @pytest.mark.parametrize("col_type", ["string", "int32", "float64", "date", "timestamp"])
    def test_is_not_complex(self, col_type):
        assert not DatabaseContext._is_complex_type_column({"type": col_type})

    @pytest.mark.parametrize("col_type", ["array<string>", "array<int>"])
    def test_is_array(self, col_type):
        assert DatabaseContext._is_array_type(col_type)

    @pytest.mark.parametrize("col_type", ["struct<x: int>", "map<string, int>", "json", "variant"])
    def test_is_not_array(self, col_type):
        assert not DatabaseContext._is_array_type(col_type)


class TestComplexTypePrimitives:
    def test_bigquery_array_unnest(self):
        ctx = make_context(BigQueryDatabaseContext)
        result = ctx._array_unnest_join("`s`.`t`", "`tags`", "val")
        assert result == "`s`.`t`, UNNEST(`tags`) AS val"

    def test_bigquery_cast_to_string(self):
        ctx = make_context(BigQueryDatabaseContext)
        assert ctx._cast_complex_to_string("`props`") == "TO_JSON_STRING(`props`)"

    def test_databricks_array_unnest(self):
        ctx = make_context(DatabricksDatabaseContext)
        result = ctx._array_unnest_join("`s`.`t`", "`tags`", "val")
        assert "LATERAL VIEW EXPLODE" in result

    def test_trino_array_unnest(self):
        ctx = make_context(TrinoDatabaseContext)
        result = ctx._array_unnest_join('"s"."t"', '"tags"', "val")
        assert "CROSS JOIN UNNEST" in result

    def test_base_returns_none(self):
        ctx = make_context(DatabaseContext)
        assert ctx._array_unnest_join("t", "c", "v") is None
        assert ctx._cast_complex_to_string("c") is None


class TestProfileComplexTypeColumn:
    def _make_ctx_with_mock_sql(self, cls, fetchone_val, fetchall_val=None):
        ctx = make_context(cls)
        ctx._fetchone = MagicMock(return_value=fetchone_val)
        ctx._fetchall = MagicMock(return_value=fetchall_val or [])
        ctx._conn.raw_sql = MagicMock(return_value=MagicMock())
        return ctx

    def test_array_col_uses_unnest_branch(self):
        ctx = self._make_ctx_with_mock_sql(
            BigQueryDatabaseContext,
            fetchone_val=(0,),  # null_count, puis distinct_count
        )
        ctx._fetchone.side_effect = [(0,), (42,)]  # null_count=0, distinct=42
        profile = ctx._profile_complex_type_column(ARRAY_COL, 1000)
        assert profile["distinct_count"] == 42
        calls = [str(c) for c in ctx._conn.raw_sql.call_args_list]
        assert any("UNNEST" in c for c in calls)

    def test_struct_col_uses_cast_branch(self):
        ctx = self._make_ctx_with_mock_sql(
            BigQueryDatabaseContext,
            fetchone_val=(0,),
        )
        ctx._fetchone.side_effect = [(0,), (10,)]
        ctx._profile_complex_type_column(STRUCT_COL, 1000)
        calls = [str(c) for c in ctx._conn.raw_sql.call_args_list]
        assert any("TO_JSON_STRING" in c for c in calls)
        assert any("UNNEST" not in c for c in calls)

    def test_base_context_returns_null_count_only(self):
        ctx = self._make_ctx_with_mock_sql(DatabaseContext, fetchone_val=(5,))
        profile = ctx._profile_complex_type_column(JSON_COL, 100)
        assert profile["null_count"] == 5
        assert profile["distinct_count"] is None
        assert "top_values" not in profile


class TestMssqlProfilingQuery:
    def test_string_column(self):
        ctx = make_context(MssqlDatabaseContext)
        sql = ctx._build_profiling_query(STR_COL)
        expected = normalize("""
            SELECT
                COUNT(*) - COUNT([status]) AS null_count,
                (SELECT COUNT(DISTINCT [status]) FROM [my_schema].[my_table] ) AS distinct_count
            FROM [my_schema].[my_table]
        """)
        assert normalize(sql) == expected

    def test_integer_column(self):
        ctx = make_context(MssqlDatabaseContext)
        sql = ctx._build_profiling_query(INT_COL)
        expected = normalize("""
            SELECT
                COUNT(*) - COUNT([id]) AS null_count,
                (SELECT COUNT(DISTINCT [id]) FROM [my_schema].[my_table] ) AS distinct_count
                , MIN([id]) AS col_min
                , MAX([id]) AS col_max
                , AVG(CAST([id] AS FLOAT)) AS col_mean
                , STDEVP(CAST([id] AS FLOAT)) AS col_stddev
            FROM [my_schema].[my_table]
        """)
        assert normalize(sql) == expected

    def test_float_column(self):
        ctx = make_context(MssqlDatabaseContext)
        sql = ctx._build_profiling_query(FLOAT_COL)
        expected = normalize("""
            SELECT
                COUNT(*) - COUNT([amount]) AS null_count,
                (SELECT COUNT(DISTINCT [amount]) FROM [my_schema].[my_table] ) AS distinct_count
                , MIN([amount]) AS col_min
                , MAX([amount]) AS col_max
                , AVG(CAST([amount] AS FLOAT)) AS col_mean
                , STDEVP(CAST([amount] AS FLOAT)) AS col_stddev
            FROM [my_schema].[my_table]
        """)
        assert normalize(sql) == expected

    def test_date_column(self):
        ctx = make_context(MssqlDatabaseContext)
        sql = ctx._build_profiling_query(DATE_COL)
        expected = normalize("""
            SELECT
                COUNT(*) - COUNT([created_at]) AS null_count,
                (SELECT COUNT(DISTINCT [created_at]) FROM [my_schema].[my_table] ) AS distinct_count
                , MIN([created_at]) AS col_min
                , MAX([created_at]) AS col_max
            FROM [my_schema].[my_table]
        """)
        assert normalize(sql) == expected


class TestBigQueryProfilingQuery:
    def test_string_column(self):
        ctx = make_context(BigQueryDatabaseContext)
        sql = ctx._build_profiling_query(STR_COL)
        expected = normalize("""
            SELECT
                COUNT(*) - COUNT(`status`) AS null_count,
                COUNT(DISTINCT `status`) AS distinct_count
            FROM `my_schema`.`my_table`
        """)
        assert normalize(sql) == expected

    def test_integer_column(self):
        ctx = make_context(BigQueryDatabaseContext)
        sql = ctx._build_profiling_query(INT_COL)
        expected = normalize("""
            SELECT
                COUNT(*) - COUNT(`id`) AS null_count,
                COUNT(DISTINCT `id`) AS distinct_count
                , MIN(`id`) AS col_min
                , MAX(`id`) AS col_max
                , AVG(CAST(`id` AS FLOAT64)) AS col_mean
                , STDDEV_POP(CAST(`id` AS FLOAT64)) AS col_stddev
            FROM `my_schema`.`my_table`
        """)
        assert normalize(sql) == expected

    def test_float_column(self):
        ctx = make_context(BigQueryDatabaseContext)
        sql = ctx._build_profiling_query(FLOAT_COL)
        expected = normalize("""
            SELECT
                COUNT(*) - COUNT(`amount`) AS null_count,
                COUNT(DISTINCT `amount`) AS distinct_count
                , MIN(`amount`) AS col_min
                , MAX(`amount`) AS col_max
                , AVG(CAST(`amount` AS FLOAT64)) AS col_mean
                , STDDEV_POP(CAST(`amount` AS FLOAT64)) AS col_stddev
            FROM `my_schema`.`my_table`
        """)
        assert normalize(sql) == expected

    def test_date_column(self):
        ctx = make_context(BigQueryDatabaseContext)
        sql = ctx._build_profiling_query(DATE_COL)
        expected = normalize("""
            SELECT
                COUNT(*) - COUNT(`created_at`) AS null_count,
                COUNT(DISTINCT `created_at`) AS distinct_count
                , MIN(`created_at`) AS col_min
                , MAX(`created_at`) AS col_max
            FROM `my_schema`.`my_table`
        """)
        assert normalize(sql) == expected

    def test_partition_filter_injected(self):
        ctx = make_context(BigQueryDatabaseContext, partition_cols=["created_at"])
        sql = ctx._build_profiling_query(STR_COL)
        expected = normalize("""
            SELECT
                COUNT(*) - COUNT(`status`) AS null_count,
                COUNT(DISTINCT `status`) AS distinct_count
            FROM `my_schema`.`my_table`
            WHERE `created_at` >= DATE_SUB(CURRENT_DATE(), INTERVAL 30 DAY)
        """)
        assert normalize(sql) == expected

    def test_no_partition_filter_when_no_partition(self):
        ctx = make_context(BigQueryDatabaseContext, partition_cols=[])
        sql = ctx._build_profiling_query(STR_COL)
        assert "WHERE" not in sql
        assert "DATE_SUB" not in sql

    def test_full_query(self):
        ctx = make_context(BigQueryDatabaseContext)
        sql = ctx._build_top_values_query(STR_COL)
        expected = normalize("""
            SELECT `status` AS value, COUNT(*) AS cnt
            FROM `my_schema`.`my_table`
            GROUP BY `status`
            ORDER BY cnt DESC, `status` ASC
            LIMIT 10
        """)
        assert normalize(sql) == expected


class TestSnowflakeProfilingQuery:
    def test_string_column(self):
        ctx = make_context(SnowflakeDatabaseContext)
        sql = ctx._build_profiling_query(STR_COL)
        expected = normalize("""
            SELECT
                COUNT(*) - COUNT("status") AS null_count,
                COUNT(DISTINCT "status") AS distinct_count
            FROM "my_schema"."my_table"
        """)
        assert normalize(sql) == expected

    def test_integer_column(self):
        ctx = make_context(SnowflakeDatabaseContext)
        sql = ctx._build_profiling_query(INT_COL)
        expected = normalize("""
            SELECT
                COUNT(*) - COUNT("id") AS null_count,
                COUNT(DISTINCT "id") AS distinct_count
                , MIN("id") AS col_min
                , MAX("id") AS col_max
                , AVG("id"::FLOAT) AS col_mean
                , STDDEV_POP("id"::FLOAT) AS col_stddev
            FROM "my_schema"."my_table"
        """)
        assert normalize(sql) == expected

    def test_float_column(self):
        ctx = make_context(SnowflakeDatabaseContext)
        sql = ctx._build_profiling_query(FLOAT_COL)
        expected = normalize("""
            SELECT
                COUNT(*) - COUNT("amount") AS null_count,
                COUNT(DISTINCT "amount") AS distinct_count
                , MIN("amount") AS col_min
                , MAX("amount") AS col_max
                , AVG("amount"::FLOAT) AS col_mean
                , STDDEV_POP("amount"::FLOAT) AS col_stddev
            FROM "my_schema"."my_table"
        """)
        assert normalize(sql) == expected

    def test_partition_filter_uses_dateadd(self):
        ctx = make_context(SnowflakeDatabaseContext)
        ctx.clustering_columns = MagicMock(return_value=["created_at"])
        sql = ctx._build_profiling_query(STR_COL)
        expected = normalize("""
            SELECT
                COUNT(*) - COUNT("status") AS null_count,
                COUNT(DISTINCT "status") AS distinct_count
            FROM "my_schema"."my_table"
            WHERE "created_at" >= DATEADD(day, -30, CURRENT_DATE())
        """)
        assert normalize(sql) == expected

    def test_full_query(self):
        ctx = make_context(SnowflakeDatabaseContext)
        sql = ctx._build_top_values_query(STR_COL)
        expected = normalize("""
            SELECT "status" AS value, COUNT(*) AS cnt
            FROM "my_schema"."my_table"
            GROUP BY "status"
            ORDER BY cnt DESC, "status" ASC
            LIMIT 10
        """)
        assert normalize(sql) == expected


class TestDatabricksProfilingQuery:
    def test_string_column(self):
        ctx = make_context(DatabricksDatabaseContext)
        sql = ctx._build_profiling_query(STR_COL)
        expected = normalize("""
            SELECT
                COUNT(*) - COUNT(`status`) AS null_count,
                COUNT(DISTINCT `status`) AS distinct_count
            FROM `my_schema`.`my_table`
        """)
        assert normalize(sql) == expected

    def test_float_column(self):
        ctx = make_context(DatabricksDatabaseContext)
        sql = ctx._build_profiling_query(FLOAT_COL)
        expected = normalize("""
            SELECT
                COUNT(*) - COUNT(`amount`) AS null_count,
                COUNT(DISTINCT `amount`) AS distinct_count
                , MIN(`amount`) AS col_min
                , MAX(`amount`) AS col_max
                , AVG(CAST(`amount` AS DOUBLE)) AS col_mean
                , STDDEV_POP(CAST(`amount` AS DOUBLE)) AS col_stddev
            FROM `my_schema`.`my_table`
        """)
        assert normalize(sql) == expected

    def test_partition_filter_uses_date_sub(self):
        ctx = make_context(DatabricksDatabaseContext, partition_cols=["created_at"])
        sql = ctx._build_profiling_query(STR_COL)
        expected = normalize("""
            SELECT
                COUNT(*) - COUNT(`status`) AS null_count,
                COUNT(DISTINCT `status`) AS distinct_count
            FROM `my_schema`.`my_table`
            WHERE `created_at` >= DATE_SUB(CURRENT_DATE(), INTERVAL 30 DAY)
        """)
        assert normalize(sql) == expected

    def test_full_query(self):
        ctx = make_context(DatabricksDatabaseContext)
        sql = ctx._build_top_values_query(STR_COL)
        expected = normalize("""
            SELECT `status` AS value, COUNT(*) AS cnt
            FROM `my_schema`.`my_table`
            GROUP BY `status`
            ORDER BY cnt DESC, `status` ASC
            LIMIT 10
        """)
        assert normalize(sql) == expected


class TestAthenaProfilingQuery:
    def test_string_column(self):
        ctx = make_context(AthenaDatabaseContext)
        sql = ctx._build_profiling_query(STR_COL)
        expected = normalize("""
            SELECT
                COUNT(*) - COUNT("status") AS null_count,
                COUNT(DISTINCT "status") AS distinct_count
            FROM "my_schema"."my_table"
        """)
        assert normalize(sql) == expected

    def test_float_column(self):
        ctx = make_context(AthenaDatabaseContext)
        sql = ctx._build_profiling_query(FLOAT_COL)
        expected = normalize("""
            SELECT
                COUNT(*) - COUNT("amount") AS null_count,
                COUNT(DISTINCT "amount") AS distinct_count
                , MIN("amount") AS col_min
                , MAX("amount") AS col_max
                , AVG(CAST("amount" AS DOUBLE)) AS col_mean
                , STDDEV_POP(CAST("amount" AS DOUBLE)) AS col_stddev
            FROM "my_schema"."my_table"
        """)
        assert normalize(sql) == expected

    def test_no_partition_filter_even_when_partition_cols_present(self):
        ctx = make_context(AthenaDatabaseContext, partition_cols=["created_at"])
        sql = ctx._build_profiling_query(STR_COL)
        assert "WHERE" not in sql

    def test_full_query(self):
        ctx = make_context(AthenaDatabaseContext)
        sql = ctx._build_top_values_query(STR_COL)
        expected = normalize("""
            SELECT "status" AS value, COUNT(*) AS cnt
            FROM "my_schema"."my_table"
            GROUP BY "status"
            ORDER BY cnt DESC, "status" ASC
            LIMIT 10
        """)
        assert normalize(sql) == expected


class TestRedshiftProfilingQuery:
    def test_string_column(self):
        ctx = make_context(RedshiftDatabaseContext)
        sql = ctx._build_profiling_query(STR_COL)
        expected = normalize("""
            SELECT
                COUNT(*) - COUNT("status") AS null_count,
                COUNT(DISTINCT "status") AS distinct_count
            FROM "my_schema"."my_table"
        """)
        assert normalize(sql) == expected

    def test_float_column(self):
        ctx = make_context(RedshiftDatabaseContext)
        sql = ctx._build_profiling_query(FLOAT_COL)
        expected = normalize("""
            SELECT
                COUNT(*) - COUNT("amount") AS null_count,
                COUNT(DISTINCT "amount") AS distinct_count
                , MIN("amount") AS col_min
                , MAX("amount") AS col_max
                , AVG("amount"::float) AS col_mean
                , STDDEV_POP("amount"::float) AS col_stddev
            FROM "my_schema"."my_table"
        """)
        assert normalize(sql) == expected

    def test_integer_column(self):
        ctx = make_context(RedshiftDatabaseContext)
        sql = ctx._build_profiling_query(INT_COL)
        expected = normalize("""
            SELECT
                COUNT(*) - COUNT("id") AS null_count,
                COUNT(DISTINCT "id") AS distinct_count
                , MIN("id") AS col_min
                , MAX("id") AS col_max
                , AVG("id"::float) AS col_mean
                , STDDEV_POP("id"::float) AS col_stddev
            FROM "my_schema"."my_table"
        """)
        assert normalize(sql) == expected

    def test_full_query(self):
        ctx = make_context(RedshiftDatabaseContext)
        sql = ctx._build_top_values_query(STR_COL)
        expected = normalize("""
            SELECT "status" AS value, COUNT(*) AS cnt
            FROM "my_schema"."my_table"
            GROUP BY "status"
            ORDER BY cnt DESC, "status" ASC
            LIMIT 10
        """)
        assert normalize(sql) == expected


class TestBaseTopValuesQuery:
    def test_string_column(self):
        ctx = make_context(DatabaseContext)
        sql = ctx._build_top_values_query(STR_COL)
        expected = normalize("""
            SELECT "status" AS value, COUNT(*) AS cnt
            FROM "my_schema"."my_table"
            GROUP BY "status"
            ORDER BY cnt DESC, "status" ASC
            LIMIT 10
        """)
        assert normalize(sql) == expected

    def test_respects_quoting(self):
        ctx = make_context(DatabaseContext)
        sql = ctx._build_top_values_query(STR_COL)
        assert '"status"' in sql
        assert '"my_schema"."my_table"' in sql


class TestMssqlTopValuesQuery:
    def test_uses_top_not_limit(self):
        ctx = make_context(MssqlDatabaseContext)
        sql = ctx._build_top_values_query(STR_COL)
        assert "TOP 10" in sql
        assert "LIMIT" not in sql

    def test_full_query(self):
        ctx = make_context(MssqlDatabaseContext)
        sql = ctx._build_top_values_query(STR_COL)
        expected = normalize("""
            SELECT TOP 10 [status] AS value, COUNT(*) AS cnt
            FROM [my_schema].[my_table]
            GROUP BY [status]
            ORDER BY cnt DESC, [status] ASC
        """)
        assert normalize(sql) == expected

    def test_uses_bracket_quoting(self):
        ctx = make_context(MssqlDatabaseContext)
        sql = ctx._build_top_values_query(STR_COL)
        assert "[status]" in sql
        assert "[my_schema].[my_table]" in sql


TRIP_COLUMNS = [
    {"name": "match_id", "type": "STRING"},
    {"name": "cancel_reason", "type": "STRING"},
]
TABLE_ROW_COUNT = 18_700_000
PROFILED_ROW_COUNT = 500_000
COLUMN_STATS = {
    "match_id": (0, 500_000),
    "cancel_reason": (350_000, 120),
}


def make_scoped_context(cls, partition_cols=None, clustering_cols=None):
    """Context whose connection answers the scoped COUNT(*) and per-column profiling queries."""
    if cls is BigQueryDatabaseContext:
        metadata = TablePartitionMetadata(
            partition_column=(partition_cols or [None])[0],
            partition_column_type="TIMESTAMP",
            last_partition_id=None,
            total_rows=TABLE_ROW_COUNT,
        )
        ctx = cls(MagicMock(), "my_schema", "trips", project_id="test-project", partition_metadata=metadata)
    else:
        ctx = cls(MagicMock(), "my_schema", "trips")
    ctx.partition_columns = MagicMock(return_value=partition_cols or [])
    ctx.columns = MagicMock(return_value=TRIP_COLUMNS)
    ctx.clustering_columns = MagicMock(return_value=clustering_cols or [])
    ctx.row_count = MagicMock(return_value=TABLE_ROW_COUNT)
    ctx._conn.raw_sql = MagicMock(side_effect=lambda sql: sql)
    ctx._fetchone = MagicMock(side_effect=answer_profiling_query)
    ctx._fetchall = MagicMock(return_value=[])
    return ctx


def answer_profiling_query(sql: str) -> tuple:
    if sql.startswith("SELECT COUNT(*) FROM"):
        return (PROFILED_ROW_COUNT,)
    column = next(name for name in COLUMN_STATS if name in sql)
    return COLUMN_STATS[column]


def executed_queries(ctx) -> list[str]:
    return [normalize(call.args[0]) for call in ctx._conn.raw_sql.call_args_list]


def profile_by_column(result: dict) -> dict[str, dict]:
    return {profile["column"]: profile for profile in result["columns"]}


class TestProfilingScope:
    """Column stats and their total_count must be computed over the same rows."""

    BIGQUERY_FILTER = "`expected_pickup_time` >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 30 DAY)"

    def test_bigquery_partitioned_total_count_matches_filtered_scope(self):
        ctx = make_scoped_context(BigQueryDatabaseContext, partition_cols=["expected_pickup_time"])

        profiles = profile_by_column(ctx.profiling())

        assert profiles["match_id"]["total_count"] == PROFILED_ROW_COUNT
        assert profiles["match_id"]["distinct_count"] == PROFILED_ROW_COUNT
        assert profiles["cancel_reason"]["total_count"] == PROFILED_ROW_COUNT
        assert profiles["cancel_reason"]["null_percentage"] == 70.0

    def test_bigquery_partitioned_scope_is_reported(self):
        ctx = make_scoped_context(BigQueryDatabaseContext, partition_cols=["expected_pickup_time"])

        result = ctx.profiling()

        assert result["scope"] == {
            "partition_filter": self.BIGQUERY_FILTER,
            "profiled_row_count": PROFILED_ROW_COUNT,
            "table_row_count": TABLE_ROW_COUNT,
        }

    def test_bigquery_count_and_column_queries_share_the_filter(self):
        ctx = make_scoped_context(BigQueryDatabaseContext, partition_cols=["expected_pickup_time"])

        ctx.profiling()

        queries = executed_queries(ctx)
        assert f"SELECT COUNT(*) FROM `my_schema`.`trips` WHERE {self.BIGQUERY_FILTER}" in queries
        assert all(f"WHERE {self.BIGQUERY_FILTER}" in query for query in queries)

    def test_complex_column_null_percentage_uses_filtered_scope(self):
        ctx = make_scoped_context(BigQueryDatabaseContext, partition_cols=["expected_pickup_time"])
        ctx.columns = MagicMock(return_value=[{"name": "props", "type": "JSON"}])
        ctx._fetchone = MagicMock(side_effect=[(PROFILED_ROW_COUNT,), (100_000,), (12,)])

        profile = ctx.profiling()["columns"][0]

        assert profile["total_count"] == PROFILED_ROW_COUNT
        assert profile["null_percentage"] == 20.0

    @pytest.mark.parametrize(
        ("cls", "partition_cols", "clustering_cols", "expected_filter"),
        [
            (
                SnowflakeDatabaseContext,
                [],
                ["CREATED_AT"],
                '"CREATED_AT" >= DATEADD(day, -30, CURRENT_DATE())',
            ),
            (
                DatabricksDatabaseContext,
                ["event_date"],
                [],
                "`event_date` >= DATE_SUB(CURRENT_DATE(), INTERVAL 30 DAY)",
            ),
        ],
    )
    def test_other_filtered_warehouses_use_filtered_scope(self, cls, partition_cols, clustering_cols, expected_filter):
        ctx = make_scoped_context(cls, partition_cols=partition_cols, clustering_cols=clustering_cols)

        result = ctx.profiling()

        assert result["scope"]["partition_filter"] == expected_filter
        assert result["scope"]["profiled_row_count"] == PROFILED_ROW_COUNT
        assert profile_by_column(result)["cancel_reason"]["null_percentage"] == 70.0
        assert all(f"WHERE {expected_filter}" in query for query in executed_queries(ctx))

    def test_table_row_count_is_none_when_full_count_fails(self):
        ctx = make_scoped_context(BigQueryDatabaseContext, partition_cols=["expected_pickup_time"])
        ctx.row_count = MagicMock(side_effect=RuntimeError("boom"))

        result = ctx.profiling()

        assert result["scope"]["table_row_count"] is None
        assert profile_by_column(result)["cancel_reason"]["total_count"] == PROFILED_ROW_COUNT

    def test_profiling_unavailable_when_scoped_count_fails(self):
        ctx = make_scoped_context(BigQueryDatabaseContext, partition_cols=["expected_pickup_time"])
        ctx._fetchone = MagicMock(side_effect=RuntimeError("boom"))

        assert ctx.profiling() is None

    @pytest.mark.parametrize("cls", [DatabaseContext, BigQueryDatabaseContext, DatabricksDatabaseContext])
    def test_unpartitioned_table_keeps_full_table_scope(self, cls):
        ctx = make_scoped_context(cls)
        ctx._fetchone = MagicMock(side_effect=lambda sql: COLUMN_STATS[next(n for n in COLUMN_STATS if n in sql)])

        result = ctx.profiling()

        assert set(result) == {"computed_at", "clustering_columns", "columns"}
        assert profile_by_column(result)["cancel_reason"]["total_count"] == TABLE_ROW_COUNT
        assert profile_by_column(result)["cancel_reason"]["null_percentage"] == round(
            350_000 / TABLE_ROW_COUNT * 100, 2
        )
        assert not any(query.startswith("SELECT COUNT(*) FROM") for query in executed_queries(ctx))
