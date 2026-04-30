"""Unit tests for Trino database config."""

from unittest.mock import MagicMock

import ibis
import pytest

from nao_core.config.databases.trino import TrinoConfig, TrinoDatabaseContext


@pytest.fixture
def base_config() -> TrinoConfig:
    return TrinoConfig(
        name="t",
        host="trino.example",
        port=8080,
        catalog="hive",
        user="alice",
        password=None,
        schema_name=None,
    )


def test_create_context_returns_trino_context(base_config: TrinoConfig) -> None:
    mock_conn = MagicMock()
    ctx = base_config.create_context(mock_conn, "analytics", "orders")
    assert isinstance(ctx, TrinoDatabaseContext)


def test_description_reads_table_comment_from_system_metadata() -> None:
    conn = MagicMock()
    conn.current_catalog = "hive"
    cursor = MagicMock()
    cursor.fetchone.return_value = ("Revenue facts",)
    conn.raw_sql.return_value = cursor

    ctx = TrinoDatabaseContext(conn, "dev_gold", "observed_interest_rates")
    assert ctx.description() == "Revenue facts"

    sql = conn.raw_sql.call_args[0][0]
    assert "system.metadata.table_comments" in sql
    assert "catalog_name" in sql and "schema_name" in sql and "table_name" in sql
    assert "hive" in sql and "dev_gold" in sql and "observed_interest_rates" in sql


def test_description_returns_none_when_query_raises() -> None:
    conn = MagicMock()
    conn.current_catalog = "hive"
    conn.raw_sql.side_effect = RuntimeError("no metadata")

    ctx = TrinoDatabaseContext(conn, "s", "t")
    assert ctx.description() is None


def test_description_returns_none_when_comment_empty() -> None:
    conn = MagicMock()
    conn.current_catalog = "hive"
    cursor = MagicMock()
    cursor.fetchone.return_value = ("   ",)
    conn.raw_sql.return_value = cursor

    ctx = TrinoDatabaseContext(conn, "s", "t")
    assert ctx.description() is None


def test_columns_merge_comment_from_describe_output() -> None:
    """DESCRIBE rows: Column | Type | Extra | Comment | ... (comment at index 3)."""
    conn = MagicMock()
    ibis_schema = ibis.schema({"id": "int64", "name": "string"})
    table = MagicMock()
    table.schema.return_value = ibis_schema
    conn.table.return_value = table

    describe_rows = [
        ("id", "bigint", "", "primary key", None),
        ("name", "varchar", "", "display name", None),
    ]
    col_cursor = MagicMock()
    col_cursor.fetchall.return_value = describe_rows
    conn.raw_sql.return_value = col_cursor

    ctx = TrinoDatabaseContext(conn, "dev", "users")
    cols = ctx.columns()

    sql = conn.raw_sql.call_args[0][0]
    assert sql.strip().startswith("DESCRIBE")
    assert '"dev"."users"' in sql

    by_name = {c["name"]: c.get("description") for c in cols}
    assert by_name["id"] == "primary key"
    assert by_name["name"] == "display name"


def test_columns_case_insensitive_comment_match() -> None:
    conn = MagicMock()
    ibis_schema = ibis.schema({"UserId": "int64"})
    table = MagicMock()
    table.schema.return_value = ibis_schema
    conn.table.return_value = table

    col_cursor = MagicMock()
    col_cursor.fetchall.return_value = [("userid", "bigint", "", "from metastore", None)]
    conn.raw_sql.return_value = col_cursor

    ctx = TrinoDatabaseContext(conn, "s", "t")
    cols = ctx.columns()
    assert cols[0]["name"] == "UserId"
    assert cols[0]["description"] == "from metastore"


def test_columns_skips_short_rows_and_empty_comment() -> None:
    conn = MagicMock()
    ibis_schema = ibis.schema({"a": "int64", "b": "int64"})
    table = MagicMock()
    table.schema.return_value = ibis_schema
    conn.table.return_value = table

    col_cursor = MagicMock()
    col_cursor.fetchall.return_value = [
        ("a", "int", ""),  # too few columns
        ("b", "int", "", "", None),  # comment empty
        ("b", "int", "", "ok", None),
    ]
    conn.raw_sql.return_value = col_cursor

    ctx = TrinoDatabaseContext(conn, "s", "t")
    cols = ctx.columns()
    by_name = {c["name"]: c.get("description") for c in cols}
    assert by_name.get("a") is None
    assert by_name["b"] == "ok"


def test_columns_unchanged_when_describe_raises() -> None:
    conn = MagicMock()
    ibis_schema = ibis.schema({"x": "int64"})
    table = MagicMock()
    table.schema.return_value = ibis_schema
    conn.table.return_value = table
    conn.raw_sql.side_effect = RuntimeError("permission denied")

    ctx = TrinoDatabaseContext(conn, "s", "t")
    cols = ctx.columns()
    assert len(cols) == 1
    assert cols[0]["name"] == "x"
    assert cols[0].get("description") is None
