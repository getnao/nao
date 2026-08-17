import fnmatch
from pathlib import Path

import pytest

from nao_core.config.databases.column_access import ColumnAccessError, validate_column_access
from nao_core.config.databases.column_catalog import column_catalog_path, write_column_catalog


class FakeDatabaseConfig:
    type = "duckdb"
    name = "test-database"

    def __init__(
        self,
        exclude_columns: list[str],
        database_name: str = "local",
        database_type: str = "duckdb",
    ):
        self.exclude_columns = exclude_columns
        self.database_name = database_name
        self.type = database_type

    def connect(self):
        raise AssertionError("column validation must not connect")

    def get_database_name(self) -> str:
        return self.database_name

    def column_matches_pattern(self, schema: str, table: str, column: str) -> bool:
        name = f"{schema}.{table}.{column}"
        return not any(fnmatch.fnmatch(name, pattern) for pattern in self.exclude_columns)


@pytest.fixture
def schemas() -> dict[str, dict[str, list[str]]]:
    return {
        "main": {
            "users": ["id", "name", "email", "secret", "ssn", "_peerdb_version"],
            "orders": ["id", "user_id", "total"],
        }
    }


@pytest.fixture
def project_path(
    tmp_path: Path,
    schemas: dict[str, dict[str, list[str]]],
) -> Path:
    write_catalog(tmp_path, FakeDatabaseConfig([]), schemas)
    return tmp_path


@pytest.fixture
def unnest_project_path(tmp_path: Path) -> Path:
    config = FakeDatabaseConfig([], database_type="bigquery")
    write_catalog(
        tmp_path,
        config,
        {
            "main": {
                "movies": ["title", "actors"],
                "dim_actors": ["name", "birth_year"],
            }
        },
    )
    return tmp_path


def write_catalog(
    project_path: Path,
    config: FakeDatabaseConfig,
    schemas: dict[str, dict[str, list[str]]],
) -> None:
    path = column_catalog_path(project_path, config.type, f"database={config.get_database_name()}")
    catalog = {
        schema: {
            table: [{"name": column, "type": "VARCHAR"} for column in columns] for table, columns in tables.items()
        }
        for schema, tables in schemas.items()
    }
    write_column_catalog(path, catalog)


def test_explicit_excluded_select_column_is_blocked(project_path: Path):
    config = FakeDatabaseConfig(["*.email"])

    with pytest.raises(ColumnAccessError, match=r"main\.users\.email"):
        validate_column_access("SELECT email FROM users", config, project_path)


@pytest.mark.parametrize(
    "sql",
    [
        "SELECT name FROM users WHERE email IS NOT NULL",
        "SELECT u.name FROM users u JOIN orders o ON u.email = o.user_id",
        "SELECT name FROM users ORDER BY email",
    ],
)
def test_explicit_excluded_column_outside_select_is_blocked(project_path: Path, sql: str):
    config = FakeDatabaseConfig(["*.email"])

    with pytest.raises(ColumnAccessError, match=r"main\.users\.email"):
        validate_column_access(sql, config, project_path)


def test_select_star_with_excluded_column_is_blocked(project_path: Path):
    config = FakeDatabaseConfig(["*.email"])

    with pytest.raises(
        ColumnAccessError,
        match=r"SELECT \* would include excluded column\(s\): main\.users\.email",
    ):
        validate_column_access("SELECT * FROM users", config, project_path)


def test_select_star_missing_from_catalog_is_allowed(tmp_path: Path):
    config = FakeDatabaseConfig(["*.email"])
    sql = "SELECT * FROM unknown_users"

    assert validate_column_access(sql, config, tmp_path) == sql


def test_qualified_star_already_excluding_column_is_unchanged(project_path: Path):
    config = FakeDatabaseConfig(["*.email"])
    sql = "SELECT u.* EXCLUDE (email) FROM users u"

    assert validate_column_access(sql, config, project_path) == sql


def test_bigquery_star_except_excluded_column_is_allowed(
    tmp_path: Path,
    schemas: dict[str, dict[str, list[str]]],
):
    config = FakeDatabaseConfig(["*.email"], database_type="bigquery")
    write_catalog(tmp_path, config, schemas)
    sql = "SELECT * EXCEPT (email) FROM users"

    assert validate_column_access(sql, config, tmp_path) == sql


@pytest.mark.parametrize("database_type", ["snowflake", "duckdb"])
def test_star_exclude_excluded_column_is_allowed(
    tmp_path: Path,
    schemas: dict[str, dict[str, list[str]]],
    database_type: str,
):
    config = FakeDatabaseConfig(["*.email"], database_type=database_type)
    write_catalog(tmp_path, config, schemas)
    sql = "SELECT * EXCLUDE (email) FROM users"

    assert validate_column_access(sql, config, tmp_path) == sql


def test_star_exclusion_missing_excluded_column_names_only_uncovered_column(
    tmp_path: Path,
    schemas: dict[str, dict[str, list[str]]],
):
    config = FakeDatabaseConfig(["*.email", "*.secret"], database_type="bigquery")
    write_catalog(tmp_path, config, schemas)

    with pytest.raises(ColumnAccessError) as error:
        validate_column_access("SELECT * EXCEPT (email) FROM users", config, tmp_path)

    assert str(error.value) == (
        "Query blocked because SELECT * would include excluded column(s): main.users.secret. "
        "Use SELECT * EXCEPT (secret) to exclude them."
    )


@pytest.mark.parametrize(
    ("database_type", "sql"),
    [
        ("bigquery", "SELECT * REPLACE ('redacted' AS email) FROM users"),
        ("snowflake", "SELECT * RENAME (email AS public_email) FROM users"),
    ],
)
def test_star_replace_or_rename_does_not_bypass_exclusion(
    tmp_path: Path,
    schemas: dict[str, dict[str, list[str]]],
    database_type: str,
    sql: str,
):
    config = FakeDatabaseConfig(["*.email"], database_type=database_type)
    write_catalog(tmp_path, config, schemas)

    with pytest.raises(ColumnAccessError):
        validate_column_access(sql, config, tmp_path)


@pytest.mark.parametrize(
    ("database_type", "advice"),
    [
        ("bigquery", "Use SELECT * EXCEPT (email) to exclude them."),
        ("snowflake", "Use SELECT * EXCLUDE (email) to exclude them."),
        ("postgres", "Select only allowed columns explicitly instead of using *."),
    ],
)
def test_select_star_block_message_uses_dialect_advice(
    tmp_path: Path,
    schemas: dict[str, dict[str, list[str]]],
    database_type: str,
    advice: str,
):
    config = FakeDatabaseConfig(["*.email"], database_type=database_type)
    write_catalog(tmp_path, config, schemas)

    with pytest.raises(ColumnAccessError) as error:
        validate_column_access("SELECT * FROM users", config, tmp_path)

    assert str(error.value) == (
        f"Query blocked because SELECT * would include excluded column(s): main.users.email. {advice}"
    )


def test_cte_star_exclusion_is_preserved(
    project_path: Path,
):
    config = FakeDatabaseConfig(["*.email"])
    sql = "WITH selected_users AS (SELECT * EXCLUDE (email) FROM users) SELECT * FROM selected_users"

    assert validate_column_access(sql, config, project_path) == sql


def test_cte_star_with_excluded_column_is_blocked(project_path: Path):
    config = FakeDatabaseConfig(["*.email"])

    with pytest.raises(
        ColumnAccessError,
        match=r"SELECT \* would include excluded column\(s\): main\.users\.email",
    ):
        validate_column_access(
            "WITH selected_users AS (SELECT * FROM users) SELECT * FROM selected_users",
            config,
            project_path,
        )


def test_explicit_excluded_column_from_cte_star_is_blocked(project_path: Path):
    config = FakeDatabaseConfig(["*.email"])

    with pytest.raises(ColumnAccessError, match=r"main\.users\.email"):
        validate_column_access(
            "WITH selected_users AS (SELECT * FROM users) SELECT email FROM selected_users",
            config,
            project_path,
        )


def test_safe_query_is_allowed_unchanged(project_path: Path):
    config = FakeDatabaseConfig(["*.email"])
    sql = "SELECT id, name FROM users WHERE id > 10"

    assert validate_column_access(sql, config, project_path) == sql


def test_unnest_alias_field_is_allowed(unnest_project_path: Path):
    config = FakeDatabaseConfig(["*.birth_year"], database_type="bigquery")
    sql = "SELECT m.title, a.name FROM movies m, UNNEST(m.actors) a"

    assert validate_column_access(sql, config, unnest_project_path) == sql


def test_nested_excluded_name_through_unnest_alias_is_allowed(unnest_project_path: Path):
    config = FakeDatabaseConfig(["*.birth_year"], database_type="bigquery")
    sql = "SELECT a.birth_year FROM movies m, UNNEST(m.actors) a"

    assert validate_column_access(sql, config, unnest_project_path) == sql


def test_excluded_unnest_argument_is_blocked(unnest_project_path: Path):
    config = FakeDatabaseConfig(["*.actors"], database_type="bigquery")

    with pytest.raises(ColumnAccessError, match=r"main\.movies\.actors"):
        validate_column_access(
            "SELECT a.name FROM movies m, UNNEST(m.actors) a",
            config,
            unnest_project_path,
        )


@pytest.mark.parametrize(
    "sql",
    [
        "SELECT x FROM UNNEST(ARRAY(SELECT birth_year FROM dim_actors)) AS x",
        "SELECT x FROM UNNEST((SELECT ARRAY_AGG(birth_year) FROM dim_actors)) AS x",
    ],
)
def test_excluded_column_in_unnest_subquery_is_blocked(unnest_project_path: Path, sql: str):
    config = FakeDatabaseConfig(["*.birth_year"], database_type="bigquery")

    with pytest.raises(ColumnAccessError, match=r"main\.dim_actors\.birth_year"):
        validate_column_access(sql, config, unnest_project_path)


def test_star_with_unnest_checks_only_catalog_sources(unnest_project_path: Path):
    config = FakeDatabaseConfig(["*.birth_year"], database_type="bigquery")
    sql = "SELECT * FROM movies m, UNNEST(m.actors) a"

    assert validate_column_access(sql, config, unnest_project_path) == sql


def test_unqualified_unnest_output_is_allowed(unnest_project_path: Path):
    config = FakeDatabaseConfig(["*.birth_year"], database_type="bigquery")
    sql = "SELECT actor FROM movies m, UNNEST(m.actors) AS actor"

    assert validate_column_access(sql, config, unnest_project_path) == sql


def test_non_unnest_lateral_scope_still_fails_closed(tmp_path: Path):
    config = FakeDatabaseConfig(["*.birth_year"], database_type="snowflake")
    write_catalog(tmp_path, config, {"main": {"movies": ["title", "actors"]}})

    with pytest.raises(ColumnAccessError, match="derived query outputs cannot be resolved safely"):
        validate_column_access(
            "SELECT f.value FROM movies m, LATERAL FLATTEN(input => m.actors) f",
            config,
            tmp_path,
        )


def test_different_catalog_is_blocked_without_local_schema_fallback(project_path: Path):
    config = FakeDatabaseConfig(["*.email"], database_name="local")

    with pytest.raises(ColumnAccessError, match="does not match the configured database"):
        validate_column_access("SELECT id FROM remote.main.users", config, project_path)


def test_matching_catalog_resolves_local_schema(project_path: Path):
    config = FakeDatabaseConfig(["*.email"], database_name="local")
    safe_sql = "SELECT id FROM LOCAL.main.users"

    assert validate_column_access(safe_sql, config, project_path) == safe_sql
    with pytest.raises(ColumnAccessError, match=r"main\.users\.email"):
        validate_column_access("SELECT email FROM LOCAL.main.users", config, project_path)


def test_multi_part_database_name_resolves_catalog_schema(tmp_path: Path):
    config = FakeDatabaseConfig(["*.email"], database_name="hive1.analytics")
    write_catalog(
        tmp_path,
        config,
        {"hive1.analytics": {"orders": ["id", "email"]}},
    )
    safe_sql = "SELECT id FROM hive1.analytics.orders"

    assert validate_column_access(safe_sql, config, tmp_path) == safe_sql
    with pytest.raises(ColumnAccessError, match=r"hive1\.analytics\.orders\.email"):
        validate_column_access("SELECT email FROM hive1.analytics.orders", config, tmp_path)


def test_multi_part_database_name_blocks_different_catalog(tmp_path: Path):
    config = FakeDatabaseConfig(["*.email"], database_name="hive1.analytics")

    with pytest.raises(ColumnAccessError, match="does not match the configured database"):
        validate_column_access("SELECT id FROM other.analytics.orders", config, tmp_path)


def test_unparseable_query_is_blocked(project_path: Path):
    config = FakeDatabaseConfig(["*.email"])

    with pytest.raises(ColumnAccessError, match="could not be parsed"):
        validate_column_access("SELECT (", config, project_path)


def test_nested_star_expression_is_blocked(project_path: Path):
    config = FakeDatabaseConfig(["*.email"])

    with pytest.raises(ColumnAccessError, match="nested inside an expression"):
        validate_column_access("SELECT ARRAY_AGG(users.*) FROM users", config, project_path)


def test_empty_exclude_columns_is_noop_without_catalog(tmp_path: Path):
    config = FakeDatabaseConfig([])
    sql = "not valid SQL"

    assert validate_column_access(sql, config, tmp_path) == sql


def test_query_without_tables_skips_catalog(tmp_path: Path):
    config = FakeDatabaseConfig(["*.email"])
    sql = "SELECT 1"

    assert validate_column_access(sql, config, tmp_path) == sql


def test_explicit_column_is_blocked_without_catalog(tmp_path: Path):
    config = FakeDatabaseConfig(["*.email"])

    with pytest.raises(ColumnAccessError, match=r"users\.email"):
        validate_column_access("SELECT email FROM users", config, tmp_path)


@pytest.mark.parametrize(
    ("pattern", "sql", "excluded_name"),
    [
        ("*.ssn", "SELECT ssn FROM main.users", "main.users.ssn"),
        ("*._peerdb_*", "SELECT _peerdb_version FROM main.users", "main.users._peerdb_version"),
        ("analytics.events.*_id", "SELECT user_id FROM analytics.events", "analytics.events.user_id"),
    ],
)
def test_glob_patterns_block_matching_columns(
    tmp_path: Path,
    pattern: str,
    sql: str,
    excluded_name: str,
):
    config = FakeDatabaseConfig([pattern])

    with pytest.raises(ColumnAccessError, match=excluded_name.replace(".", r"\.")):
        validate_column_access(sql, config, tmp_path)


def test_table_pattern_does_not_affect_other_tables(project_path: Path):
    config = FakeDatabaseConfig(["main.users.email"])
    sql = "SELECT email FROM main.orders"

    assert validate_column_access(sql, config, project_path) == sql


def test_ambiguous_column_checks_every_candidate_table(tmp_path: Path):
    config = FakeDatabaseConfig(["analytics.users.email"])
    write_catalog(
        tmp_path,
        config,
        {
            "main": {"users": ["id", "email"]},
            "analytics": {"users": ["id", "email"]},
        },
    )

    with pytest.raises(ColumnAccessError, match=r"analytics\.users\.email"):
        validate_column_access("SELECT email FROM users", config, tmp_path)


def test_unqualified_join_column_checks_every_missing_catalog_table(tmp_path: Path):
    config = FakeDatabaseConfig(["main.accounts.ssn"])

    with pytest.raises(ColumnAccessError, match=r"main\.accounts\.ssn"):
        validate_column_access(
            "SELECT ssn FROM main.customers c JOIN main.accounts a ON c.id = a.id",
            config,
            tmp_path,
        )
