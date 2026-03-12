"""Unit tests for query history extraction and analysis."""

from nao_core.commands.sync.providers.databases.query_history import (
    TableUsageStats,
    compute_table_usage,
    extract_join_pairs,
    extract_table_references,
)


class TestExtractTableReferences:
    def test_simple_select(self):
        sql = "SELECT * FROM users"
        refs = extract_table_references(sql)
        assert "users" in refs

    def test_qualified_table(self):
        sql = "SELECT * FROM analytics.orders"
        refs = extract_table_references(sql)
        assert any("orders" in r for r in refs)

    def test_join_tables(self):
        sql = "SELECT * FROM users u JOIN orders o ON u.id = o.user_id"
        refs = extract_table_references(sql)
        assert any("users" in r for r in refs)
        assert any("orders" in r for r in refs)

    def test_multiple_joins(self):
        sql = """
		SELECT * FROM users u
		JOIN orders o ON u.id = o.user_id
		JOIN products p ON o.product_id = p.id
		"""
        refs = extract_table_references(sql)
        assert any("users" in r for r in refs)
        assert any("orders" in r for r in refs)
        assert any("products" in r for r in refs)

    def test_subquery(self):
        sql = "SELECT * FROM (SELECT id FROM users) sub JOIN orders ON sub.id = orders.user_id"
        refs = extract_table_references(sql)
        assert any("users" in r for r in refs)
        assert any("orders" in r for r in refs)

    def test_empty_query(self):
        refs = extract_table_references("")
        assert refs == []

    def test_invalid_sql_falls_back(self):
        sql = "NOT REALLY SQL BUT FROM some_table JOIN another_table"
        refs = extract_table_references(sql)
        assert any("some_table" in r for r in refs)
        assert any("another_table" in r for r in refs)


class TestExtractJoinPairs:
    def test_simple_join(self):
        sql = "SELECT * FROM users JOIN orders ON users.id = orders.user_id"
        pairs = extract_join_pairs(sql)
        assert len(pairs) >= 1
        left, right = pairs[0]
        assert "users" in left
        assert "orders" in right

    def test_no_joins(self):
        sql = "SELECT * FROM users"
        pairs = extract_join_pairs(sql)
        assert pairs == []

    def test_multiple_joins(self):
        sql = """
		SELECT * FROM users u
		JOIN orders o ON u.id = o.user_id
		JOIN products p ON o.product_id = p.id
		"""
        pairs = extract_join_pairs(sql)
        assert len(pairs) >= 2


class TestComputeTableUsage:
    def test_basic_usage_count(self):
        queries = [
            "SELECT * FROM schema1.users",
            "SELECT * FROM schema1.users WHERE id = 1",
            "SELECT * FROM schema1.orders",
        ]
        selected = [("schema1", "users"), ("schema1", "orders")]
        stats = compute_table_usage(queries, selected)

        assert stats["schema1.users"].usage_count == 2
        assert stats["schema1.orders"].usage_count == 1

    def test_no_matching_queries(self):
        queries = ["SELECT * FROM other_table"]
        selected = [("schema1", "users")]
        stats = compute_table_usage(queries, selected)

        assert stats["schema1.users"].usage_count == 0

    def test_empty_queries(self):
        stats = compute_table_usage([], [("schema1", "users")])
        assert stats["schema1.users"].usage_count == 0

    def test_join_tracking(self):
        queries = [
            "SELECT * FROM users JOIN orders ON users.id = orders.user_id",
            "SELECT * FROM users JOIN orders ON users.id = orders.user_id",
            "SELECT * FROM users JOIN products ON users.id = products.buyer_id",
        ]
        selected = [("public", "users"), ("public", "orders"), ("public", "products")]
        stats = compute_table_usage(queries, selected)

        assert stats["public.users"].usage_count == 3
        user_joins = dict(stats["public.users"].common_joins)
        assert "orders" in user_joins or any("orders" in k for k in user_joins)

    def test_top_queries(self):
        repeated_sql = "SELECT id, name FROM schema1.users WHERE active = true"
        queries = [repeated_sql] * 5 + ["SELECT * FROM schema1.users LIMIT 10"]
        selected = [("schema1", "users")]
        stats = compute_table_usage(queries, selected)

        assert stats["schema1.users"].usage_count == 6
        assert len(stats["schema1.users"].top_queries) > 0
        top_sql, top_count = stats["schema1.users"].top_queries[0]
        assert top_count == 5

    def test_returns_empty_stats_for_all_selected_tables(self):
        stats = compute_table_usage(
            [],
            [("s1", "t1"), ("s2", "t2")],
        )
        assert "s1.t1" in stats
        assert "s2.t2" in stats
        assert stats["s1.t1"].usage_count == 0
        assert stats["s2.t2"].usage_count == 0


class TestTableUsageStats:
    def test_default_values(self):
        stats = TableUsageStats()
        assert stats.usage_count == 0
        assert stats.common_joins == []
        assert stats.top_queries == []
