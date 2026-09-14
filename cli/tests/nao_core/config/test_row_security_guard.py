import pytest

from nao_core.config.databases.row_security_guard import (
    RowSecurityGuardError,
    RowSecurityPolicy,
    enforce_row_security,
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


def test_rejects_unsupported_dialect():
    config = FakeDatabaseConfig()
    config.type = "unknown"

    with pytest.raises(RowSecurityGuardError, match="not supported"):
        enforce_row_security("SELECT * FROM orders", config, policy())
