import duckdb
import pytest
import sqlglot
from sqlglot import exp

from nao_core.config.databases.row_security_guard import (
    RowSecurityGuardError,
    RowSecurityPolicy,
    enforce_row_security,
    validate_row_security_predicate,
)


class FakeConnection:
    def __init__(self):
        self.schemas = {"main": ["orders", "users"]}
        self.disconnected = False

    def list_tables(self, database: str) -> list[str]:
        return self.schemas[database]

    def disconnect(self) -> None:
        self.disconnected = True


class FakeDatabaseConfig:
    type = "duckdb"

    def __init__(self):
        self.connection = FakeConnection()

    def connect(self) -> FakeConnection:
        return self.connection

    def get_database_name(self) -> str:
        return "local"

    def get_schemas(self, conn: FakeConnection) -> list[str]:
        return list(conn.schemas)


def policy(
    predicate: str = "tenant_id = 7",
) -> dict[tuple[str, str], RowSecurityPolicy]:
    return {
        ("main", "orders"): {
            "access": "predicate",
            "constraint_columns": ["tenant_id", "region"],
            "predicate": predicate,
        }
    }


def test_injects_predicate_with_table_alias():
    sql = enforce_row_security(
        "SELECT o.id FROM orders AS o WHERE o.active = TRUE",
        FakeDatabaseConfig(),
        policy(),
    )

    assert "o.active = TRUE AND o.tenant_id = 7" in sql


def test_filters_each_sensitive_table_in_join():
    policies: dict[tuple[str, str], RowSecurityPolicy] = {
        **policy(),
        ("main", "users"): {
            "access": "predicate",
            "constraint_columns": ["region"],
            "predicate": "region IN ('eu', 'us')",
        },
    }

    sql = enforce_row_security(
        "SELECT * FROM orders o JOIN users u ON o.user_id = u.id",
        FakeDatabaseConfig(),
        policies,
    )

    assert "o.tenant_id = 7" in sql
    assert "u.region IN ('eu', 'us')" in sql


def test_preserves_left_join_rows_by_filtering_the_nullable_side_in_on():
    sql = enforce_row_security(
        "SELECT * FROM orders o LEFT JOIN users u ON o.user_id = u.id WHERE o.active = TRUE",
        FakeDatabaseConfig(),
        {
            ("main", "users"): {
                "access": "predicate",
                "constraint_columns": ["region"],
                "predicate": "region = 'eu'",
            }
        },
    )

    assert "LEFT JOIN users AS u ON o.user_id = u.id AND u.region = 'eu'" in sql
    assert "WHERE o.active = TRUE" in sql


def test_preserves_outer_join_using_by_prefiltering_the_nullable_side():
    left_sql = enforce_row_security(
        "SELECT o.id, u.region FROM orders o LEFT JOIN users u USING (user_id) ORDER BY o.id",
        FakeDatabaseConfig(),
        {
            ("main", "users"): {
                "access": "predicate",
                "constraint_columns": ["region"],
                "predicate": "region = 'eu'",
            }
        },
    )
    right_sql = enforce_row_security(
        "SELECT o.id, u.region FROM orders o RIGHT JOIN users u USING (user_id) ORDER BY u.user_id",
        FakeDatabaseConfig(),
        policy(),
    )

    assert "LEFT JOIN (SELECT * FROM users AS u WHERE u.region = 'eu') AS u USING (user_id)" in left_sql
    assert (
        "FROM (SELECT * FROM orders AS o WHERE o.tenant_id = 7) AS o RIGHT JOIN users AS u USING (user_id)" in right_sql
    )
    with duckdb.connect() as conn:
        conn.execute("CREATE TABLE orders (id INTEGER, user_id INTEGER, tenant_id INTEGER)")
        conn.execute("INSERT INTO orders VALUES (1, 10, 8), (2, 20, 7)")
        conn.execute("CREATE TABLE users (user_id INTEGER, region VARCHAR)")
        conn.execute("INSERT INTO users VALUES (10, 'us'), (20, 'eu')")
        assert conn.execute(left_sql).fetchall() == [(1, None), (2, "eu")]
        assert conn.execute(right_sql).fetchall() == [(None, "us"), (2, "eu")]


def test_preserves_right_join_rows_by_filtering_the_nullable_side_in_on():
    sql = enforce_row_security(
        "SELECT * FROM orders o RIGHT JOIN users u ON o.user_id = u.id",
        FakeDatabaseConfig(),
        policy(),
    )

    assert "RIGHT JOIN users AS u ON o.user_id = u.id AND o.tenant_id = 7" in sql
    assert "WHERE o.tenant_id" not in sql


def test_preserves_full_join_rows_by_prefiltering_each_protected_source():
    sql = enforce_row_security(
        'SELECT * FROM main.orders AS "Order Source" FULL OUTER JOIN main.users AS "User Source" '
        'ON "Order Source".user_id = "User Source".id',
        FakeDatabaseConfig(),
        {
            **policy(),
            ("main", "users"): {
                "access": "predicate",
                "constraint_columns": ["region"],
                "predicate": "region = 'eu'",
            },
        },
    )

    assert '(SELECT * FROM main.orders AS "Order Source" WHERE "Order Source".tenant_id = 7) AS "Order Source"' in sql
    assert '(SELECT * FROM main.users AS "User Source" WHERE "User Source".region = \'eu\') AS "User Source"' in sql


def test_rejects_qualified_full_join_table_without_explicit_alias():
    with pytest.raises(RowSecurityGuardError, match="require an explicit alias"):
        enforce_row_security(
            "SELECT * FROM main.orders FULL OUTER JOIN users ON main.orders.user_id = users.id",
            FakeDatabaseConfig(),
            policy(),
        )


def test_filters_nested_query_and_cte_base_table():
    sql = enforce_row_security(
        "WITH scoped AS (SELECT * FROM orders o) SELECT * FROM scoped",
        FakeDatabaseConfig(),
        policy(),
    )

    assert "WHERE o.tenant_id = 7" in sql
    assert sql.count("tenant_id") == 1


def test_no_policy_state_denies_all_rows():
    policies: dict[tuple[str, str], RowSecurityPolicy] = {
        ("main", "orders"): {
            "access": "none",
            "constraint_columns": ["tenant_id"],
            "predicate": None,
        }
    }

    sql = enforce_row_security(
        "SELECT * FROM orders",
        FakeDatabaseConfig(),
        policies,
    )

    assert "WHERE FALSE" in sql


def test_full_access_does_not_add_filter():
    policies: dict[tuple[str, str], RowSecurityPolicy] = {
        ("main", "orders"): {
            "access": "full",
            "constraint_columns": ["tenant_id"],
            "predicate": None,
        }
    }

    assert (
        enforce_row_security(
            "SELECT * FROM orders",
            FakeDatabaseConfig(),
            policies,
        )
        == "SELECT * FROM orders"
    )


@pytest.mark.parametrize(
    "predicate",
    [
        "tenant_id = 1; DELETE FROM orders",
        "tenant_id = (SELECT tenant_id FROM users)",
        "other_column = 1",
        "users.tenant_id = 1",
        "tenant_id = ?",
        "tenant_id = :tenant",
        "LOWER(region) = 'eu'",
        "tenant_id = 1 -- bypass",
        "* = 1",
    ],
)
def test_rejects_unsafe_predicates(predicate: str):
    with pytest.raises(RowSecurityGuardError):
        enforce_row_security(
            "SELECT * FROM orders",
            FakeDatabaseConfig(),
            policy(predicate),
        )


@pytest.mark.parametrize(
    "predicate",
    [
        "tenant_id = 1 OR 1 = 1",
        "tenant_id = 1 AND 2 <> 3",
        "tenant_id = 1 OR TRUE",
    ],
)
def test_rejects_comparison_branches_not_grounded_in_constraint_columns(predicate: str):
    with pytest.raises(RowSecurityGuardError, match="every row predicate comparison"):
        enforce_row_security(
            "SELECT * FROM orders",
            FakeDatabaseConfig(),
            policy(predicate),
        )


def test_allows_each_and_or_branch_to_reference_constraint_columns():
    sql = enforce_row_security(
        "SELECT * FROM orders",
        FakeDatabaseConfig(),
        policy("tenant_id = 1 OR (region = 'eu' AND tenant_id > 10)"),
    )

    assert "tenant_id = 1 OR (orders.region = 'eu' AND orders.tenant_id > 10)" in sql


def test_preserves_quoted_alias_metadata_when_qualifying_predicates():
    sql = enforce_row_security(
        'SELECT * FROM orders AS "Case Sensitive"',
        FakeDatabaseConfig(),
        policy(),
    )

    assert '"Case Sensitive".tenant_id = 7' in sql


@pytest.mark.parametrize("database_type", ["mysql", "starrocks"])
def test_mysql_like_compiled_payload_stays_one_literal(database_type: str):
    predicate = r"`tenant_id` = 'north\\'' OR 1 = 1'"

    normalized = validate_row_security_predicate(predicate, ["tenant_id"], database_type)
    expression = sqlglot.parse_one(normalized, read="mysql", into=exp.Condition)

    assert isinstance(expression, exp.EQ)
    assert isinstance(expression.expression, exp.Literal)
    assert expression.expression.this == r"north\' OR 1 = 1"


def test_rejects_unsupported_dialect():
    config = FakeDatabaseConfig()
    config.type = "unknown"

    with pytest.raises(RowSecurityGuardError, match="not supported"):
        enforce_row_security("SELECT * FROM orders", config, policy())
