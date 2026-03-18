"""Unit tests for profiling query generation across warehouses."""

from unittest.mock import MagicMock

from nao_core.config.databases.athena import AthenaDatabaseContext
from nao_core.config.databases.bigquery import BigQueryDatabaseContext
from nao_core.config.databases.context import DatabaseContext
from nao_core.config.databases.databricks import DatabricksDatabaseContext
from nao_core.config.databases.mssql import MssqlDatabaseContext
from nao_core.config.databases.redshift import RedshiftDatabaseContext
from nao_core.config.databases.snowflake import SnowflakeDatabaseContext


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
