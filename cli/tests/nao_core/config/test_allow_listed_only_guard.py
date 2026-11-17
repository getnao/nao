from pathlib import Path

import pytest

from nao_core.config.databases.allow_listed_only_guard import (
    AllowListedOnlyGuardError,
    enforce_allow_listed_only,
    load_allowed_context_tables,
    query_references_base_tables,
)
from nao_core.config.databases.athena import AthenaConfig

DOTTED_SCHEMAS = {"a.b": ["c"], "a": ["b.c"]}


class FakeConnection:
    def __init__(self, schemas: dict[str, list[str]]):
        self.schemas = schemas
        self.disconnected = False

    def list_tables(self, database: str) -> list[str]:
        return self.schemas[database]

    def disconnect(self) -> None:
        self.disconnected = True


class FakeDatabaseConfig:
    name = "local"

    def __init__(
        self,
        allow_listed_only: bool,
        schemas: dict[str, list[str]] | None = None,
        database_name: str = "local",
        database_type: str = "duckdb",
    ):
        self.type = database_type
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

    def get_catalog_names(self) -> list[str]:
        return [self.get_database_name()]

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

    assert_allowed("SELECT * FROM users", config, tmp_path)
    assert config.connect_count == 0


def test_request_only_table_access_allows_exact_table(tmp_path: Path):
    assert_allowed("SELECT * FROM main.orders", FakeDatabaseConfig(False), tmp_path, {("main", "orders")})


def test_request_only_table_access_blocks_denied_join(tmp_path: Path):
    assert_blocked(
        "SELECT * FROM orders JOIN users USING (id)",
        FakeDatabaseConfig(False),
        tmp_path,
        {("main", "orders")},
        match=r"Context table permissions.*main\.users",
    )


def test_request_and_synced_context_are_intersected(tmp_path: Path):
    create_context_table(tmp_path, "main", "orders")
    config = FakeDatabaseConfig(True)

    assert_blocked("SELECT * FROM users", config, tmp_path, {("main", "users")}, match=r"main\.users")
    assert_blocked("SELECT * FROM orders", config, tmp_path, {("main", "users")}, match=r"main\.orders")


def test_empty_request_access_denies_tables_but_allows_tableless_query(tmp_path: Path):
    config = FakeDatabaseConfig(False)

    assert_allowed("SELECT 1", config, tmp_path, set())
    assert_blocked("SELECT * FROM orders", config, tmp_path, set(), match=r"main\.orders")


def test_request_access_preserves_quoted_exact_case_resolution(tmp_path: Path):
    config = FakeDatabaseConfig(False, {"main": ["Orders"]})

    assert_allowed('SELECT * FROM main."Orders"', config, tmp_path, {("main", "Orders")})


def test_postgres_unquoted_and_quoted_tables_resolve_distinct_case(tmp_path: Path):
    config = FakeDatabaseConfig(False, {"public": ["orders", "Orders"]}, database_type="postgres")

    unquoted_sql = "SELECT * FROM PUBLIC.Orders"
    assert_allowed(unquoted_sql, config, tmp_path, {("public", "orders")})
    assert_blocked(unquoted_sql, config, tmp_path, {("public", "Orders")}, match=r"public\.orders")

    quoted_sql = 'SELECT * FROM public."Orders"'
    assert_allowed(quoted_sql, config, tmp_path, {("public", "Orders")})
    assert_blocked(quoted_sql, config, tmp_path, {("public", "orders")}, match=r"public\.Orders")


def test_postgres_catalog_and_schema_preserve_quoted_case(tmp_path: Path):
    config = FakeDatabaseConfig(
        False,
        {
            "catalog.public": ["orders"],
            "catalog.Public": ["orders"],
        },
        database_name="catalog.public",
        database_type="postgres",
    )

    assert_allowed("SELECT * FROM CATALOG.Public.Orders", config, tmp_path, {("catalog.public", "orders")})
    assert_allowed('SELECT * FROM catalog."Public".orders', config, tmp_path, {("catalog.Public", "orders")})
    assert_blocked(
        'SELECT * FROM "CATALOG".public.orders',
        config,
        tmp_path,
        {("catalog.public", "orders")},
        match="does not match",
    )


def test_case_insensitive_dialect_preserves_unquoted_matching(tmp_path: Path):
    config = FakeDatabaseConfig(False, {"main": ["Orders"]})

    assert_allowed("SELECT * FROM MAIN.orders", config, tmp_path, {("main", "Orders")})


def test_structured_identity_does_not_collide_on_dots(tmp_path: Path):
    config = FakeDatabaseConfig(False, DOTTED_SCHEMAS, database_type="postgres")

    dotted_schema_sql = 'SELECT * FROM "a.b".c'
    assert_allowed(dotted_schema_sql, config, tmp_path, {("a.b", "c")})
    assert_blocked(dotted_schema_sql, config, tmp_path, {("a", "b.c")})

    dotted_table_sql = 'SELECT * FROM a."b.c"'
    assert_allowed(dotted_table_sql, config, tmp_path, {("a", "b.c")})
    assert_blocked(dotted_table_sql, config, tmp_path, {("a.b", "c")})


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
    create_context_table(tmp_path, schema, table, database_type="postgres")
    config = FakeDatabaseConfig(True, DOTTED_SCHEMAS, database_type="postgres")

    assert_blocked(blocked_sql, config, tmp_path)


def test_request_access_fails_closed_for_unsupported_dialect(tmp_path: Path):
    config = FakeDatabaseConfig(False, database_type="unsupported")

    assert_blocked("SELECT * FROM orders", config, tmp_path, {("main", "orders")}, match="not supported")


def test_motherduck_uses_duckdb_dialect_for_request_access(tmp_path: Path):
    config = FakeDatabaseConfig(False, database_type="motherduck")

    assert_allowed("SELECT * FROM main.orders", config, tmp_path, {("main", "orders")})


def test_ducklake_uses_duckdb_dialect_for_request_access(tmp_path: Path):
    config = FakeDatabaseConfig(
        False,
        {"lake.marts": ["communes"], "lake.raw": ["communes_source"]},
        database_name="lake",
    )
    config.type = "ducklake"
    sql = "SELECT * FROM lake.marts.communes"

    assert (
        enforce_allow_listed_only(
            sql,
            config,
            tmp_path,
            group_allowed_tables={("lake.marts", "communes")},
        )
        == sql
    )


def test_ducklake_request_access_blocks_ungranted_schema(tmp_path: Path):
    config = FakeDatabaseConfig(
        False,
        {"lake.marts": ["communes"], "lake.raw": ["communes_source"]},
        database_name="lake",
    )
    config.type = "ducklake"

    with pytest.raises(AllowListedOnlyGuardError, match=r"Denied table\(s\): lake\.raw\.communes_source"):
        enforce_allow_listed_only(
            "SELECT * FROM lake.raw.communes_source",
            config,
            tmp_path,
            group_allowed_tables={("lake.marts", "communes")},
        )


def test_ducklake_request_access_blocks_table_functions(tmp_path: Path):
    config = FakeDatabaseConfig(False, {"lake.marts": ["communes"]}, database_name="lake")
    config.type = "ducklake"

    with pytest.raises(AllowListedOnlyGuardError, match="dynamic table reference"):
        enforce_allow_listed_only(
            "SELECT * FROM read_parquet('s3://lake/warehouse/raw/*.parquet')",
            config,
            tmp_path,
            group_allowed_tables={("lake.marts", "communes")},
        )


def test_listed_qualified_table_is_allowed(tmp_path: Path):
    create_context_table(tmp_path, "main", "orders")

    assert_allowed("SELECT * FROM main.orders", FakeDatabaseConfig(True), tmp_path)


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

    assert_blocked("SELECT * FROM main.users", config, tmp_path, match=r"main\.users")


def test_starrocks_short_schema_resolves_to_canonical_schema(tmp_path: Path):
    create_context_table(tmp_path, "default_catalog.analytics", "events", database_type="starrocks")
    config = FakeDatabaseConfig(True, {"default_catalog.analytics": ["events"]}, database_type="starrocks")

    assert_allowed("SELECT * FROM analytics.events", config, tmp_path)
    assert_blocked("SELECT * FROM other.events", config, tmp_path)


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
        database_type="starrocks",
    )

    assert_allowed("SELECT * FROM default_catalog.analytics.events", config, tmp_path)
    assert_blocked(
        "SELECT * FROM other_catalog.analytics.events",
        config,
        tmp_path,
        match="does not match the connected database",
    )


def test_snowflake_catalog_compares_folded_like_the_engine(tmp_path: Path):
    """Snowflake folds unquoted identifiers to uppercase, so the connected database
    name from nao_config.yaml has to be folded before comparing. A lowercase
    `database: prod` entry must not reject `prod.common.table`.
    """
    config = FakeDatabaseConfig(
        False,
        {"COMMON": ["RECAP__TEXT"]},
        database_name="prod",
    )
    config.type = "snowflake"
    allowed = {("COMMON", "RECAP__TEXT")}

    for sql in (
        "select * from prod.common.recap__text",
        "select * from PROD.COMMON.RECAP__TEXT",
    ):
        assert enforce_allow_listed_only(sql, config, tmp_path, group_allowed_tables=allowed) == sql

    upper_config = FakeDatabaseConfig(
        False,
        {"COMMON": ["RECAP__TEXT"]},
        database_name="PROD",
    )
    upper_config.type = "snowflake"
    assert (
        enforce_allow_listed_only(
            "select * from prod.common.recap__text",
            upper_config,
            tmp_path,
            group_allowed_tables=allowed,
        )
        == "select * from prod.common.recap__text"
    )


def test_snowflake_multi_part_database_name_folds_the_leading_candidate(tmp_path: Path):
    """A configured name like `hive1.analytics` produces the cumulative candidates
    `hive1` and `hive1.analytics`, folded for unquoted requests, so a query naming a
    prefix of the configured name as its catalog matches whatever case it is written
    in. The live schemas are unqualified here, so only the folded configured name can
    accept that catalog. `other1.analytics` is not a prefix and is still not the
    connected database.
    """
    for configured in ("hive1.analytics", "HIVE1.Analytics"):
        config = FakeDatabaseConfig(
            False,
            {"ANALYTICS": ["ORDERS"]},
            database_name=configured,
        )
        config.type = "snowflake"
        allowed = {("ANALYTICS", "ORDERS")}

        for sql in (
            "select id from hive1.analytics.orders",
            "select id from HIVE1.ANALYTICS.ORDERS",
        ):
            assert enforce_allow_listed_only(sql, config, tmp_path, group_allowed_tables=allowed) == sql

    other_catalog = FakeDatabaseConfig(
        False,
        {"ANALYTICS": ["ORDERS"]},
        database_name="hive1.analytics",
    )
    other_catalog.type = "snowflake"
    with pytest.raises(AllowListedOnlyGuardError, match="does not match the connected database"):
        enforce_allow_listed_only(
            "select id from other1.analytics.orders",
            other_catalog,
            tmp_path,
            group_allowed_tables={("ANALYTICS", "ORDERS")},
        )


def test_snowflake_quoted_catalog_matches_the_configured_spelling(tmp_path: Path):
    config = FakeDatabaseConfig(
        False,
        {"COMMON": ["RECAP__TEXT"]},
        database_name="prod",
    )
    config.type = "snowflake"

    assert (
        enforce_allow_listed_only(
            'select * from "prod".common.recap__text',
            config,
            tmp_path,
            group_allowed_tables={("COMMON", "RECAP__TEXT")},
        )
        == 'select * from "prod".common.recap__text'
    )

    with pytest.raises(AllowListedOnlyGuardError, match="does not match the connected database"):
        enforce_allow_listed_only(
            'select * from "PROD".common.recap__text',
            config,
            tmp_path,
            group_allowed_tables={("COMMON", "RECAP__TEXT")},
        )


def test_snowflake_other_catalog_is_still_blocked(tmp_path: Path):
    config = FakeDatabaseConfig(
        False,
        {"COMMON": ["RECAP__TEXT"]},
        database_name="prod",
    )
    config.type = "snowflake"

    with pytest.raises(AllowListedOnlyGuardError, match="does not match the connected database"):
        enforce_allow_listed_only(
            "select * from other_db.common.recap__text",
            config,
            tmp_path,
            group_allowed_tables={("COMMON", "RECAP__TEXT")},
        )


def test_starrocks_quoted_identifiers_match_exact_case(tmp_path: Path):
    config = FakeDatabaseConfig(
        False,
        {"default_catalog.analytics": ["events", "Events"]},
        database_name="default_catalog.analytics",
        database_type="starrocks",
    )
    lowercase_events = {("default_catalog.analytics", "events")}
    sibling_sql = 'SELECT * FROM "default_catalog"."analytics"."Events"'

    assert_allowed('SELECT * FROM "default_catalog"."analytics"."events"', config, tmp_path, lowercase_events)
    assert_allowed(sibling_sql, config, tmp_path, {("default_catalog.analytics", "Events")})
    assert_blocked(sibling_sql, config, tmp_path, lowercase_events, match=r"default_catalog\.analytics\.Events")
    assert_blocked(
        'SELECT * FROM "DEFAULT_CATALOG"."analytics"."events"',
        config,
        tmp_path,
        lowercase_events,
        match="does not match the connected database",
    )


def test_explicit_catalog_does_not_fall_back_to_another_catalog_schema(tmp_path: Path):
    config = FakeDatabaseConfig(
        False,
        {"other_catalog.analytics": ["events"]},
        database_name="default_catalog.analytics",
        database_type="starrocks",
    )

    assert_blocked(
        "SELECT * FROM default_catalog.analytics.events",
        config,
        tmp_path,
        {("other_catalog.analytics", "events")},
        match="default_catalog.analytics",
    )


def test_unqualified_tables_resolve_against_live_schema(tmp_path: Path):
    create_context_table(tmp_path, "main", "orders")
    config = FakeDatabaseConfig(True)

    assert_allowed("SELECT * FROM orders", config, tmp_path)
    with pytest.raises(AllowListedOnlyGuardError, match=r"main\.users"):
        enforce_allow_listed_only("SELECT * FROM users", config, tmp_path, conn=config.connection)


def test_cte_references_only_its_base_table(tmp_path: Path):
    create_context_table(tmp_path, "main", "orders")

    assert_allowed(
        "WITH recent AS (SELECT * FROM orders) SELECT * FROM recent",
        FakeDatabaseConfig(True),
        tmp_path,
    )


def test_query_without_tables_is_allowed_without_connecting(tmp_path: Path):
    config = FakeDatabaseConfig(True)

    assert_allowed("SELECT 1", config, tmp_path)
    assert config.connect_count == 0


@pytest.mark.parametrize(
    ("sql", "expected"),
    [
        ("SELECT 1", False),
        ("SELECT * FROM main.orders", True),
        pytest.param("SELECT (", True, id="unparseable_query_conservatively_references_base_tables"),
    ],
)
def test_query_references_base_tables(sql: str, expected: bool):
    assert query_references_base_tables(sql, "duckdb") is expected


def test_unparseable_query_is_blocked(tmp_path: Path):
    assert_blocked("SELECT (", FakeDatabaseConfig(True), tmp_path, match="the SQL could not be parsed")


def test_empty_context_reports_that_no_tables_are_synced(tmp_path: Path):
    assert_blocked(
        "SELECT * FROM users",
        FakeDatabaseConfig(True),
        tmp_path,
        match="No tables are currently present in synced context",
    )


def test_clickhouse_context_uses_sanitized_config_name(tmp_path: Path):
    create_context_table(
        tmp_path,
        "default",
        "events",
        database_type="clickhouse",
        database_folder="analytics_prod",
    )
    config = FakeDatabaseConfig(True, database_type="clickhouse")
    config.name = "analytics prod"

    assert load_allowed_context_tables(tmp_path, config) == {("default", "events")}


class FakeAthenaConfig(FakeDatabaseConfig):
    def __init__(self, allow_listed_only: bool, **kwargs):
        super().__init__(allow_listed_only, database_type="athena", **kwargs)

    def get_catalog_names(self) -> list[str]:
        return AthenaConfig(name="athena", s3_staging_dir="s3://results", region_name="us-east-1").get_catalog_names()


def test_athena_default_catalog_is_accepted_without_bypassing_allowlist(tmp_path: Path):
    create_context_table(tmp_path, "analytics", "events", database_type="athena", database_folder="default")
    config = FakeAthenaConfig(True, database_name="default")
    conn = FakeConnection({"analytics": ["events", "secrets"]})
    sql = 'SELECT * FROM "awsdatacatalog"."analytics"."events"'

    assert enforce_allow_listed_only(sql, config, tmp_path, conn=conn) == sql
    with pytest.raises(AllowListedOnlyGuardError, match=r"analytics\.secrets"):
        enforce_allow_listed_only("SELECT * FROM awsdatacatalog.analytics.secrets", config, tmp_path, conn=conn)


def test_athena_schema_name_is_not_accepted_as_catalog(tmp_path: Path):
    create_context_table(tmp_path, "analytics", "events", database_type="athena", database_folder="default")
    config = FakeAthenaConfig(True, database_name="default")
    conn = FakeConnection({"analytics": ["events"]})

    with pytest.raises(AllowListedOnlyGuardError, match="does not match the connected database"):
        enforce_allow_listed_only('SELECT * FROM "default"."analytics"."events"', config, tmp_path, conn=conn)


def assert_allowed(
    sql: str,
    config: FakeDatabaseConfig,
    project_folder: Path,
    group_allowed_tables: set[tuple[str, str]] | None = None,
) -> None:
    assert enforce_allow_listed_only(sql, config, project_folder, group_allowed_tables=group_allowed_tables) == sql


def assert_blocked(
    sql: str,
    config: FakeDatabaseConfig,
    project_folder: Path,
    group_allowed_tables: set[tuple[str, str]] | None = None,
    *,
    match: str | None = None,
) -> None:
    with pytest.raises(AllowListedOnlyGuardError, match=match):
        enforce_allow_listed_only(sql, config, project_folder, group_allowed_tables=group_allowed_tables)
