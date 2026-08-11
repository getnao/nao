from pathlib import Path

import pytest

from nao_core.config.databases.allow_listed_only_guard import (
    AllowListedOnlyGuardError,
    enforce_allow_listed_only,
    load_allowed_context_tables,
)


class FakeConnection:
    def __init__(self, schemas: dict[str, list[str]]):
        self.schemas = schemas
        self.disconnected = False

    def list_tables(self, database: str) -> list[str]:
        return self.schemas[database]

    def disconnect(self) -> None:
        self.disconnected = True


class FakeDatabaseConfig:
    type = "duckdb"
    name = "local"

    def __init__(
        self,
        allow_listed_only: bool,
        schemas: dict[str, list[str]] | None = None,
    ):
        self.allow_listed_only = allow_listed_only
        self.schemas = schemas or {"main": ["orders", "users"]}
        self.connection = FakeConnection(self.schemas)
        self.connect_count = 0

    def connect(self) -> FakeConnection:
        self.connect_count += 1
        return self.connection

    def get_database_name(self) -> str:
        return "local"

    def get_schemas(self, conn: FakeConnection) -> list[str]:
        return list(conn.schemas)


def create_context_table(
    project_folder: Path,
    schema: str,
    table: str,
    *,
    database_type: str = "duckdb",
    database_folder: str = "local",
) -> None:
    (
        project_folder
        / "databases"
        / f"type={database_type}"
        / f"database={database_folder}"
        / f"schema={schema}"
        / f"table={table}"
    ).mkdir(parents=True)


def test_flag_off_is_noop_for_unlisted_table(tmp_path: Path):
    config = FakeDatabaseConfig(False)
    sql = "SELECT * FROM users"

    assert enforce_allow_listed_only(sql, config, tmp_path) == sql
    assert config.connect_count == 0


def test_listed_qualified_table_is_allowed(tmp_path: Path):
    create_context_table(tmp_path, "main", "orders")
    config = FakeDatabaseConfig(True)
    sql = "SELECT * FROM main.orders"

    assert enforce_allow_listed_only(sql, config, tmp_path) == sql


def test_unlisted_qualified_table_is_blocked(tmp_path: Path):
    create_context_table(tmp_path, "main", "orders")
    config = FakeDatabaseConfig(True)

    with pytest.raises(
        AllowListedOnlyGuardError,
        match=r"Unlisted table\(s\): main\.users",
    ):
        enforce_allow_listed_only("SELECT * FROM main.users", config, tmp_path)


def test_unqualified_tables_resolve_against_live_schema(tmp_path: Path):
    create_context_table(tmp_path, "main", "orders")
    config = FakeDatabaseConfig(True)
    allowed_sql = "SELECT * FROM orders"

    assert enforce_allow_listed_only(allowed_sql, config, tmp_path) == allowed_sql

    with pytest.raises(AllowListedOnlyGuardError, match=r"main\.users"):
        enforce_allow_listed_only(
            "SELECT * FROM users",
            config,
            tmp_path,
            conn=config.connection,
        )


def test_cte_references_only_its_base_table(tmp_path: Path):
    create_context_table(tmp_path, "main", "orders")
    config = FakeDatabaseConfig(True)
    sql = "WITH recent AS (SELECT * FROM orders) SELECT * FROM recent"

    assert enforce_allow_listed_only(sql, config, tmp_path) == sql


def test_query_without_tables_is_allowed_without_connecting(tmp_path: Path):
    config = FakeDatabaseConfig(True)
    sql = "SELECT 1"

    assert enforce_allow_listed_only(sql, config, tmp_path) == sql
    assert config.connect_count == 0


def test_unparseable_query_is_blocked(tmp_path: Path):
    config = FakeDatabaseConfig(True)

    with pytest.raises(AllowListedOnlyGuardError, match="the SQL could not be parsed"):
        enforce_allow_listed_only("SELECT (", config, tmp_path)


def test_empty_context_reports_that_no_tables_are_synced(tmp_path: Path):
    config = FakeDatabaseConfig(True)

    with pytest.raises(
        AllowListedOnlyGuardError,
        match="No tables are currently present in synced context",
    ):
        enforce_allow_listed_only("SELECT * FROM users", config, tmp_path)


def test_clickhouse_context_uses_sanitized_config_name(tmp_path: Path):
    create_context_table(
        tmp_path,
        "default",
        "events",
        database_type="clickhouse",
        database_folder="analytics_prod",
    )
    config = FakeDatabaseConfig(True)
    config.type = "clickhouse"
    config.name = "analytics prod"

    assert load_allowed_context_tables(tmp_path, config) == {"default.events"}
