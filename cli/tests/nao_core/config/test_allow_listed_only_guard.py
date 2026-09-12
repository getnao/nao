from pathlib import Path

import pytest

from nao_core.config.databases.allow_listed_only_guard import (
    AllowListedOnlyGuardError,
    enforce_allow_listed_only,
    load_allowed_context_tables,
    query_references_base_tables,
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
        database_name: str = "local",
    ):
        self.allow_listed_only = allow_listed_only
        self.schemas = schemas or {"main": ["orders", "users"]}
        self.database_name = database_name
        self.connection = FakeConnection(self.schemas)
        self.connect_count = 0

    def connect(self) -> FakeConnection:
        self.connect_count += 1
        return self.connection

    def get_database_name(self) -> str:
        return self.database_name

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


def test_request_only_table_access_allows_exact_table(tmp_path: Path):
    config = FakeDatabaseConfig(False)
    sql = "SELECT * FROM main.orders"

    assert (
        enforce_allow_listed_only(
            sql,
            config,
            tmp_path,
            group_allowed_tables={("main", "orders")},
        )
        == sql
    )


def test_request_only_table_access_blocks_denied_join(tmp_path: Path):
    config = FakeDatabaseConfig(False)

    with pytest.raises(
        AllowListedOnlyGuardError,
        match=r"Context table permissions.*main\.users",
    ):
        enforce_allow_listed_only(
            "SELECT * FROM orders JOIN users USING (id)",
            config,
            tmp_path,
            group_allowed_tables={("main", "orders")},
        )


def test_request_and_synced_context_are_intersected(tmp_path: Path):
    create_context_table(tmp_path, "main", "orders")
    config = FakeDatabaseConfig(True)

    with pytest.raises(AllowListedOnlyGuardError, match=r"main\.users"):
        enforce_allow_listed_only(
            "SELECT * FROM users",
            config,
            tmp_path,
            group_allowed_tables={("main", "users")},
        )

    with pytest.raises(AllowListedOnlyGuardError, match=r"main\.orders"):
        enforce_allow_listed_only(
            "SELECT * FROM orders",
            config,
            tmp_path,
            group_allowed_tables={("main", "users")},
        )


def test_empty_request_access_denies_tables_but_allows_tableless_query(tmp_path: Path):
    config = FakeDatabaseConfig(False)

    assert (
        enforce_allow_listed_only(
            "SELECT 1",
            config,
            tmp_path,
            group_allowed_tables=set(),
        )
        == "SELECT 1"
    )
    with pytest.raises(AllowListedOnlyGuardError, match=r"main\.orders"):
        enforce_allow_listed_only(
            "SELECT * FROM orders",
            config,
            tmp_path,
            group_allowed_tables=set(),
        )


def test_request_access_preserves_quoted_exact_case_resolution(tmp_path: Path):
    config = FakeDatabaseConfig(False, {"main": ["Orders"]})
    sql = 'SELECT * FROM main."Orders"'

    assert (
        enforce_allow_listed_only(
            sql,
            config,
            tmp_path,
            group_allowed_tables={("main", "Orders")},
        )
        == sql
    )


def test_postgres_unquoted_and_quoted_tables_resolve_distinct_case(tmp_path: Path):
    config = FakeDatabaseConfig(False, {"public": ["orders", "Orders"]})
    config.type = "postgres"

    unquoted_sql = "SELECT * FROM PUBLIC.Orders"
    assert (
        enforce_allow_listed_only(
            unquoted_sql,
            config,
            tmp_path,
            group_allowed_tables={("public", "orders")},
        )
        == unquoted_sql
    )
    with pytest.raises(AllowListedOnlyGuardError, match=r"public\.orders"):
        enforce_allow_listed_only(
            unquoted_sql,
            config,
            tmp_path,
            group_allowed_tables={("public", "Orders")},
        )

    quoted_sql = 'SELECT * FROM public."Orders"'
    assert (
        enforce_allow_listed_only(
            quoted_sql,
            config,
            tmp_path,
            group_allowed_tables={("public", "Orders")},
        )
        == quoted_sql
    )
    with pytest.raises(AllowListedOnlyGuardError, match=r"public\.Orders"):
        enforce_allow_listed_only(
            quoted_sql,
            config,
            tmp_path,
            group_allowed_tables={("public", "orders")},
        )


def test_postgres_catalog_and_schema_preserve_quoted_case(tmp_path: Path):
    config = FakeDatabaseConfig(
        False,
        {
            "catalog.public": ["orders"],
            "catalog.Public": ["orders"],
        },
        database_name="catalog.public",
    )
    config.type = "postgres"

    unquoted_sql = "SELECT * FROM CATALOG.Public.Orders"
    assert (
        enforce_allow_listed_only(
            unquoted_sql,
            config,
            tmp_path,
            group_allowed_tables={("catalog.public", "orders")},
        )
        == unquoted_sql
    )

    quoted_schema_sql = 'SELECT * FROM catalog."Public".orders'
    assert (
        enforce_allow_listed_only(
            quoted_schema_sql,
            config,
            tmp_path,
            group_allowed_tables={("catalog.Public", "orders")},
        )
        == quoted_schema_sql
    )

    with pytest.raises(AllowListedOnlyGuardError, match="does not match"):
        enforce_allow_listed_only(
            'SELECT * FROM "CATALOG".public.orders',
            config,
            tmp_path,
            group_allowed_tables={("catalog.public", "orders")},
        )


def test_case_insensitive_dialect_preserves_unquoted_matching(tmp_path: Path):
    config = FakeDatabaseConfig(False, {"main": ["Orders"]})
    sql = "SELECT * FROM MAIN.orders"

    assert (
        enforce_allow_listed_only(
            sql,
            config,
            tmp_path,
            group_allowed_tables={("main", "Orders")},
        )
        == sql
    )


def test_structured_identity_does_not_collide_on_dots(tmp_path: Path):
    config = FakeDatabaseConfig(
        False,
        {
            "a.b": ["c"],
            "a": ["b.c"],
        },
    )
    config.type = "postgres"

    dotted_schema_sql = 'SELECT * FROM "a.b".c'
    assert (
        enforce_allow_listed_only(
            dotted_schema_sql,
            config,
            tmp_path,
            group_allowed_tables={("a.b", "c")},
        )
        == dotted_schema_sql
    )
    with pytest.raises(AllowListedOnlyGuardError):
        enforce_allow_listed_only(
            dotted_schema_sql,
            config,
            tmp_path,
            group_allowed_tables={("a", "b.c")},
        )

    dotted_table_sql = 'SELECT * FROM a."b.c"'
    assert (
        enforce_allow_listed_only(
            dotted_table_sql,
            config,
            tmp_path,
            group_allowed_tables={("a", "b.c")},
        )
        == dotted_table_sql
    )
    with pytest.raises(AllowListedOnlyGuardError):
        enforce_allow_listed_only(
            dotted_table_sql,
            config,
            tmp_path,
            group_allowed_tables={("a.b", "c")},
        )


@pytest.mark.parametrize(
    ("allowed_identity", "blocked_sql"),
    [
        (("a.b", "c"), 'SELECT * FROM a."b.c"'),
        (("a", "b.c"), 'SELECT * FROM "a.b".c'),
    ],
)
def test_synced_context_identity_does_not_collide_on_dots(
    tmp_path: Path,
    allowed_identity: tuple[str, str],
    blocked_sql: str,
):
    schema, table = allowed_identity
    create_context_table(
        tmp_path,
        schema,
        table,
        database_type="postgres",
    )
    config = FakeDatabaseConfig(
        True,
        {
            "a.b": ["c"],
            "a": ["b.c"],
        },
    )
    config.type = "postgres"

    with pytest.raises(AllowListedOnlyGuardError):
        enforce_allow_listed_only(blocked_sql, config, tmp_path)


def test_request_access_fails_closed_for_unsupported_dialect(tmp_path: Path):
    config = FakeDatabaseConfig(False)
    config.type = "unsupported"

    with pytest.raises(AllowListedOnlyGuardError, match="not supported"):
        enforce_allow_listed_only(
            "SELECT * FROM orders",
            config,
            tmp_path,
            group_allowed_tables={("main", "orders")},
        )


def test_motherduck_uses_duckdb_dialect_for_request_access(tmp_path: Path):
    config = FakeDatabaseConfig(False)
    config.type = "motherduck"
    sql = "SELECT * FROM main.orders"

    assert (
        enforce_allow_listed_only(
            sql,
            config,
            tmp_path,
            group_allowed_tables={("main", "orders")},
        )
        == sql
    )


def test_listed_qualified_table_is_allowed(tmp_path: Path):
    create_context_table(tmp_path, "main", "orders")
    config = FakeDatabaseConfig(True)
    sql = "SELECT * FROM main.orders"

    assert enforce_allow_listed_only(sql, config, tmp_path) == sql


def test_unlisted_qualified_table_is_blocked(tmp_path: Path):
    create_context_table(tmp_path, "main", "orders")
    config = FakeDatabaseConfig(True)

    with pytest.raises(AllowListedOnlyGuardError) as error:
        enforce_allow_listed_only("SELECT * FROM main.users", config, tmp_path)

    message = str(error.value)
    assert "Unlisted table(s): main.users" in message
    assert "Only synced context tables are allowed - list/read context to see them." in message


def test_allowlist_requires_exact_resolved_table_name(tmp_path: Path):
    create_context_table(tmp_path, "main", "Users")
    config = FakeDatabaseConfig(True, {"main": ["users"]})

    with pytest.raises(AllowListedOnlyGuardError, match=r"main\.users"):
        enforce_allow_listed_only("SELECT * FROM main.users", config, tmp_path)


def test_starrocks_short_schema_resolves_to_canonical_schema(tmp_path: Path):
    create_context_table(
        tmp_path,
        "default_catalog.analytics",
        "events",
        database_type="starrocks",
    )
    config = FakeDatabaseConfig(
        True,
        {"default_catalog.analytics": ["events"]},
    )
    config.type = "starrocks"
    allowed_sql = "SELECT * FROM analytics.events"

    assert enforce_allow_listed_only(allowed_sql, config, tmp_path) == allowed_sql

    with pytest.raises(AllowListedOnlyGuardError):
        enforce_allow_listed_only("SELECT * FROM other.events", config, tmp_path)


def test_starrocks_default_catalog_resolves_from_live_schemas(tmp_path: Path):
    create_context_table(
        tmp_path,
        "default_catalog.analytics",
        "events",
        database_type="starrocks",
        database_folder="analytics",
    )
    config = FakeDatabaseConfig(
        True,
        {"default_catalog.analytics": ["events"]},
        database_name="analytics",
    )
    config.type = "starrocks"
    allowed_sql = "SELECT * FROM default_catalog.analytics.events"

    assert enforce_allow_listed_only(allowed_sql, config, tmp_path) == allowed_sql

    with pytest.raises(AllowListedOnlyGuardError, match="does not match the connected database"):
        enforce_allow_listed_only("SELECT * FROM other_catalog.analytics.events", config, tmp_path)


def test_starrocks_quoted_identifiers_match_case_insensitively(tmp_path: Path):
    config = FakeDatabaseConfig(
        False,
        {"default_catalog.analytics": ["events"]},
        database_name="default_catalog.analytics",
    )
    config.type = "starrocks"
    sql = 'SELECT * FROM "DEFAULT_CATALOG"."ANALYTICS"."EVENTS"'

    assert (
        enforce_allow_listed_only(
            sql,
            config,
            tmp_path,
            group_allowed_tables={("default_catalog.analytics", "events")},
        )
        == sql
    )


def test_explicit_catalog_does_not_fall_back_to_another_catalog_schema(
    tmp_path: Path,
):
    config = FakeDatabaseConfig(
        False,
        {"other_catalog.analytics": ["events"]},
        database_name="default_catalog.analytics",
    )
    config.type = "starrocks"

    with pytest.raises(AllowListedOnlyGuardError, match="default_catalog.analytics"):
        enforce_allow_listed_only(
            "SELECT * FROM default_catalog.analytics.events",
            config,
            tmp_path,
            group_allowed_tables={("other_catalog.analytics", "events")},
        )


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


@pytest.mark.parametrize(
    ("sql", "expected"),
    [
        ("SELECT 1", False),
        ("SELECT * FROM main.orders", True),
    ],
)
def test_query_references_base_tables(sql: str, expected: bool):
    assert query_references_base_tables(sql, "duckdb") is expected


def test_unparseable_query_conservatively_references_base_tables():
    assert query_references_base_tables("SELECT (", "duckdb") is True


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

    assert load_allowed_context_tables(tmp_path, config) == {("default", "events")}
