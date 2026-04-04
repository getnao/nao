"""Unit tests for profiling query generation across warehouses."""

from unittest.mock import MagicMock

import pytest

from nao_core.config.databases.athena import AthenaDatabaseContext
from nao_core.config.databases.bigquery import BigQueryDatabaseContext
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
        ctx = make_context(SnowflakeDatabaseContext, partition_cols=["created_at"])
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
