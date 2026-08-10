import fnmatch

import pytest

from nao_core.config.databases.exclude_columns_guard import (
    ExcludeColumnsGuardError,
    enforce_exclude_columns,
)


class FakeSchema:
    def __init__(self, names: list[str]):
        self.names = names

    def items(self) -> list[tuple[str, None]]:
        return [(name, None) for name in self.names]


class FakeTable:
    def __init__(self, columns: list[str]):
        self.columns = columns

    def schema(self) -> FakeSchema:
        return FakeSchema(self.columns)


class FakeConnection:
    def __init__(self, schemas: dict[str, dict[str, list[str]]]):
        self.schemas = schemas
        self.disconnected = False

    def list_tables(self, database: str) -> list[str]:
        return list(self.schemas[database])

    def table(self, name: str, database: str) -> FakeTable:
        return FakeTable(self.schemas[database][name])

    def disconnect(self) -> None:
        self.disconnected = True


class FakeDatabaseConfig:
    type = "duckdb"

    def __init__(
        self,
        exclude_columns: list[str],
        schemas: dict[str, dict[str, list[str]]] | None = None,
    ):
        self.exclude_columns = exclude_columns
        self.schemas = schemas or {
            "main": {
                "users": ["id", "name", "email", "secret"],
                "orders": ["id", "user_id", "total"],
            }
        }
        self.connection = FakeConnection(self.schemas)
        self.connect_count = 0

    def connect(self) -> FakeConnection:
        self.connect_count += 1
        return self.connection

    def get_schemas(self, conn: FakeConnection) -> list[str]:
        return list(conn.schemas)

    def column_matches_pattern(self, schema: str, table: str, column: str) -> bool:
        name = f"{schema}.{table}.{column}"
        return not any(fnmatch.fnmatch(name, pattern) for pattern in self.exclude_columns)


def test_explicit_excluded_select_column_is_blocked():
    config = FakeDatabaseConfig(["*.email"])

    with pytest.raises(ExcludeColumnsGuardError, match=r"main\.users\.email"):
        enforce_exclude_columns("SELECT email FROM users", config)


@pytest.mark.parametrize(
    "sql",
    [
        "SELECT name FROM users WHERE email IS NOT NULL",
        "SELECT u.name FROM users u JOIN orders o ON u.email = o.user_id",
        "SELECT name FROM users ORDER BY email",
    ],
)
def test_explicit_excluded_column_outside_select_is_blocked(sql: str):
    config = FakeDatabaseConfig(["*.email"])

    with pytest.raises(ExcludeColumnsGuardError, match=r"main\.users\.email"):
        enforce_exclude_columns(sql, config)


def test_select_star_strips_excluded_columns_and_warns():
    config = FakeDatabaseConfig(["*.email"])

    result = enforce_exclude_columns("SELECT * FROM users", config)

    assert result.sql == "SELECT users.id AS id, users.name AS name, users.secret AS secret FROM main.users AS users"
    assert result.warnings == ["Excluded columns removed from SELECT * before execution: main.users.email."]


def test_qualified_star_already_excluding_column_is_unchanged():
    config = FakeDatabaseConfig(["*.email"])
    sql = "SELECT u.* EXCLUDE (email) FROM users u"

    result = enforce_exclude_columns(sql, config)

    assert result.sql == sql
    assert result.warnings == []


def test_cte_star_strips_excluded_columns():
    config = FakeDatabaseConfig(["*.email"])

    result = enforce_exclude_columns(
        "WITH selected_users AS (SELECT * FROM users) SELECT * FROM selected_users",
        config,
    )

    assert "users.email" not in result.sql
    assert "users.name AS name" in result.sql
    assert result.warnings


def test_explicit_excluded_column_from_cte_star_is_blocked():
    config = FakeDatabaseConfig(["*.email"])

    with pytest.raises(ExcludeColumnsGuardError, match=r"main\.users\.email"):
        enforce_exclude_columns(
            "WITH selected_users AS (SELECT * FROM users) SELECT email FROM selected_users",
            config,
        )


def test_safe_query_is_allowed_unchanged():
    config = FakeDatabaseConfig(["*.email"])
    sql = "SELECT id, name FROM users WHERE id > 10"

    result = enforce_exclude_columns(sql, config)

    assert result.sql == sql
    assert result.warnings == []


def test_unparseable_query_is_blocked():
    config = FakeDatabaseConfig(["*.email"])

    with pytest.raises(ExcludeColumnsGuardError, match="could not be parsed"):
        enforce_exclude_columns("SELECT (", config)


def test_nested_star_expression_is_blocked():
    config = FakeDatabaseConfig(["*.email"])

    with pytest.raises(ExcludeColumnsGuardError, match="nested inside an expression"):
        enforce_exclude_columns("SELECT ARRAY_AGG(users.*) FROM users", config)


def test_empty_exclude_columns_is_noop_without_connecting():
    config = FakeDatabaseConfig([])
    sql = "not valid SQL"

    result = enforce_exclude_columns(sql, config)

    assert result.sql == sql
    assert result.warnings == []
    assert config.connect_count == 0


@pytest.mark.parametrize(
    ("patterns", "sql", "excluded_name"),
    [
        (["*.secret"], "SELECT secret FROM users", "main.users.secret"),
        (["main.users.email"], "SELECT email FROM users", "main.users.email"),
    ],
)
def test_glob_patterns_block_matching_columns(
    patterns: list[str],
    sql: str,
    excluded_name: str,
):
    config = FakeDatabaseConfig(patterns)

    with pytest.raises(ExcludeColumnsGuardError, match=excluded_name.replace(".", r"\.")):
        enforce_exclude_columns(sql, config)


def test_ambiguous_unqualified_table_is_blocked():
    config = FakeDatabaseConfig(
        ["*.email"],
        schemas={
            "main": {"users": ["id", "email"]},
            "analytics": {"users": ["id", "email"]},
        },
    )

    with pytest.raises(ExcludeColumnsGuardError, match="ambiguous"):
        enforce_exclude_columns("SELECT * FROM users", config)
