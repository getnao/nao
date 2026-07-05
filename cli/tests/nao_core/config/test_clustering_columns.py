from unittest.mock import MagicMock

from nao_core.config.databases.databricks import DatabricksDatabaseContext
from nao_core.config.databases.snowflake import SnowflakeDatabaseContext


class TestSnowflakeClusteringColumns:
    def _make_context(self) -> tuple[SnowflakeDatabaseContext, MagicMock]:
        conn = MagicMock()
        ctx = SnowflakeDatabaseContext(conn, "ANALYTICS", "ORDERS")
        return ctx, conn

    def test_returns_parsed_clustering_key(self):
        ctx, conn = self._make_context()
        cursor = MagicMock()
        cursor.fetchone.return_value = ("LINEAR(CUSTOMER_ID, CREATED_AT)",)
        conn.raw_sql.return_value = cursor

        cols = ctx.clustering_columns()

        assert cols == ["CUSTOMER_ID", "CREATED_AT"]

    def test_returns_empty_when_no_clustering_key(self):
        ctx, conn = self._make_context()
        cursor = MagicMock()
        cursor.fetchone.return_value = (None,)
        conn.raw_sql.return_value = cursor

        assert ctx.clustering_columns() == []

    def test_returns_empty_on_query_failure(self):
        ctx, conn = self._make_context()
        conn.raw_sql.side_effect = Exception("permission denied")

        assert ctx.clustering_columns() == []


class TestDatabricksClusteringColumns:
    def _make_context(self) -> tuple[DatabricksDatabaseContext, MagicMock]:
        conn = MagicMock()
        ctx = DatabricksDatabaseContext(conn, "analytics", "orders")
        return ctx, conn

    def test_returns_liquid_clustering_columns(self):
        ctx, conn = self._make_context()
        cursor = MagicMock()
        cursor.description = [
            ("format",),
            ("id",),
            ("clusteringColumns",),
            ("numFiles",),
        ]
        cursor.fetchone.return_value = ("delta", "abc123", ["customer_id", "created_at"], 5)
        conn.raw_sql.return_value = cursor

        cols = ctx.clustering_columns()

        assert cols == ["customer_id", "created_at"]

    def test_returns_empty_when_no_liquid_clustering(self):
        ctx, conn = self._make_context()
        cursor = MagicMock()
        cursor.description = [
            ("format",),
            ("id",),
            ("clusteringColumns",),
        ]
        cursor.fetchone.return_value = ("delta", "abc123", [])
        conn.raw_sql.return_value = cursor

        assert ctx.clustering_columns() == []

    def test_returns_empty_when_column_not_in_describe_detail(self):
        ctx, conn = self._make_context()
        cursor = MagicMock()
        cursor.description = [("format",), ("id",)]
        cursor.fetchone.return_value = ("delta", "abc123")
        conn.raw_sql.return_value = cursor

        assert ctx.clustering_columns() == []

    def test_returns_empty_on_query_failure(self):
        ctx, conn = self._make_context()
        conn.raw_sql.side_effect = Exception("table not found")

        assert ctx.clustering_columns() == []
