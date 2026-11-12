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
        conn.raw_sql.return_value.fetchone.return_value = ("LINEAR(CUSTOMER_ID, CREATED_AT)",)

        cols = ctx.clustering_columns()

        assert cols == ["CUSTOMER_ID", "CREATED_AT"]

    def test_returns_empty_when_no_clustering_key(self):
        ctx, conn = self._make_context()
        conn.raw_sql.return_value.fetchone.return_value = (None,)

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
        _stub_describe_detail(
            conn, format="delta", id="abc123", clusteringColumns=["customer_id", "created_at"], numFiles=5
        )

        cols = ctx.clustering_columns()

        assert cols == ["customer_id", "created_at"]

    def test_returns_empty_when_no_liquid_clustering(self):
        ctx, conn = self._make_context()
        _stub_describe_detail(conn, format="delta", id="abc123", clusteringColumns=[])

        assert ctx.clustering_columns() == []

    def test_returns_empty_when_column_not_in_describe_detail(self):
        ctx, conn = self._make_context()
        _stub_describe_detail(conn, format="delta", id="abc123")

        assert ctx.clustering_columns() == []

    def test_returns_empty_on_query_failure(self):
        ctx, conn = self._make_context()
        conn.raw_sql.side_effect = Exception("table not found")

        assert ctx.clustering_columns() == []


def _stub_describe_detail(conn: MagicMock, **detail: object) -> None:
    cursor = conn.raw_sql.return_value
    cursor.description = [(column,) for column in detail]
    cursor.fetchone.return_value = tuple(detail.values())
