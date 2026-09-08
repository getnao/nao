import json
import tempfile
from pathlib import Path
from types import SimpleNamespace

import duckdb
import main
import pytest
import yaml
from fastapi.testclient import TestClient
from main import app

INTERNAL_SECRET = "test-internal-secret-at-least-20-characters"
INTERNAL_HEADERS = {"X-Nao-Internal-Secret": INTERNAL_SECRET}
UNENFORCED_TABLE_ACCESS = {"enforced": False}


@pytest.fixture(autouse=True)
def internal_secret(monkeypatch):
    monkeypatch.setenv("BETTER_AUTH_SECRET", INTERNAL_SECRET)


def assert_sql_result(
    data: dict, *, row_count: int, columns: list[str], expected_data: list[dict]
):
    """Assert that SQL response data matches expected values."""
    assert data["row_count"] == row_count
    assert data["columns"] == columns
    assert len(data["data"]) == row_count
    assert data["data"] == expected_data


@pytest.fixture
def duckdb_project_folder():
    """Create a temporary project folder with a DuckDB config."""
    with tempfile.TemporaryDirectory() as tmpdir:
        config = {
            "project_name": "test-project",
            "databases": [
                {
                    "name": "test-duckdb",
                    "type": "duckdb",
                    "path": ":memory:",
                }
            ],
        }
        config_path = Path(tmpdir) / "nao_config.yaml"
        with config_path.open("w") as f:
            yaml.dump(config, f)
        yield tmpdir


@pytest.fixture
def duckdb_project_with_excluded_columns():
    with tempfile.TemporaryDirectory() as tmpdir:
        database_path = Path(tmpdir) / "test.duckdb"
        conn = duckdb.connect(str(database_path))
        conn.execute("CREATE TABLE users (id INTEGER, name VARCHAR, email VARCHAR)")
        conn.execute("INSERT INTO users VALUES (1, 'Alice', 'alice@example.com')")
        conn.close()

        config = {
            "project_name": "test-project",
            "databases": [
                {
                    "name": "test-duckdb",
                    "type": "duckdb",
                    "path": str(database_path),
                    "exclude_columns": ["*.email"],
                }
            ],
        }
        config_path = Path(tmpdir) / "nao_config.yaml"
        with config_path.open("w") as f:
            yaml.dump(config, f)
        catalog_path = (
            Path(tmpdir)
            / ".meta"
            / "databases"
            / "type=duckdb"
            / "database=test"
            / "columns.json"
        )
        catalog_path.parent.mkdir(parents=True)
        catalog_path.write_text(
            json.dumps(
                {
                    "version": 1,
                    "schemas": {
                        "main": {
                            "users": [
                                {"name": "id", "type": "INTEGER"},
                                {"name": "name", "type": "VARCHAR"},
                                {"name": "email", "type": "VARCHAR"},
                            ]
                        }
                    },
                }
            )
        )
        yield tmpdir


@pytest.fixture
def duckdb_project_with_listed_tables_only():
    with tempfile.TemporaryDirectory() as tmpdir:
        project_path = Path(tmpdir)
        database_path = project_path / "test.duckdb"
        conn = duckdb.connect(str(database_path))
        conn.execute("CREATE TABLE orders (id INTEGER, total INTEGER)")
        conn.execute("INSERT INTO orders VALUES (1, 25)")
        conn.execute("CREATE TABLE users (id INTEGER, name VARCHAR)")
        conn.execute("INSERT INTO users VALUES (1, 'Alice')")
        conn.close()

        config = {
            "project_name": "test-project",
            "databases": [
                {
                    "name": "test-duckdb",
                    "type": "duckdb",
                    "path": str(database_path),
                    "allow_listed_only": True,
                }
            ],
        }
        config_path = project_path / "nao_config.yaml"
        with config_path.open("w") as f:
            yaml.dump(config, f)

        (
            project_path
            / "databases"
            / "type=duckdb"
            / "database=test"
            / "schema=main"
            / "table=orders"
        ).mkdir(parents=True)
        yield tmpdir


def test_health_does_not_require_internal_secret():
    response = TestClient(app).get("/health")

    assert response.status_code == 200, response.text


@pytest.mark.parametrize("headers", [{}, {"X-Nao-Internal-Secret": "wrong-secret"}])
def test_internal_routes_reject_missing_or_wrong_secret(headers):
    client = TestClient(app, headers=INTERNAL_HEADERS)
    client.headers.pop("X-Nao-Internal-Secret")

    response = client.post(
        "/execute_sql",
        headers=headers,
        json={
            "sql": "SELECT 1",
            "nao_project_folder": "/tmp",
            "table_access": UNENFORCED_TABLE_ACCESS,
        },
    )

    assert response.status_code == 401


def test_internal_routes_fail_closed_without_configured_secret(monkeypatch):
    monkeypatch.delenv("BETTER_AUTH_SECRET")

    response = TestClient(app, headers=INTERNAL_HEADERS).post(
        "/execute_sql",
        json={
            "sql": "SELECT 1",
            "nao_project_folder": "/tmp",
            "table_access": UNENFORCED_TABLE_ACCESS,
        },
    )

    assert response.status_code == 503


@pytest.mark.parametrize(
    "table_access",
    [
        "missing",
        None,
        {},
        {"enforced": 0},
        {"enforced": 1},
        {"enforced": "false"},
        {"enforced": "true", "tables": []},
        {"enforced": True},
        {"enforced": False, "tables": []},
        {
            "enforced": True,
            "tables": [
                {
                    "database_type": "duckdb",
                    "database": "test",
                    "schema": "main",
                }
            ],
        },
    ],
)
@pytest.mark.parametrize("endpoint", ["/execute_sql", "/validate_sql"])
def test_sql_endpoint_rejects_missing_null_or_malformed_table_access(
    duckdb_project_folder,
    table_access,
    endpoint,
):
    request = {
        "sql": "SELECT 1",
        "nao_project_folder": duckdb_project_folder,
    }
    if table_access != "missing":
        request["table_access"] = table_access

    response = TestClient(app, headers=INTERNAL_HEADERS).post(
        endpoint, json=request
    )

    assert response.status_code == 422


def test_execute_sql_rejects_extra_table_access_fields(duckdb_project_folder):
    response = TestClient(app, headers=INTERNAL_HEADERS).post(
        "/execute_sql",
        json={
            "sql": "SELECT 1",
            "nao_project_folder": duckdb_project_folder,
            "table_access": {"enforced": False, "tables": []},
        },
    )

    assert response.status_code == 422


@pytest.mark.parametrize("endpoint", ["/execute_sql", "/validate_sql"])
def test_database_authorization_identity_collision_is_rejected(
    monkeypatch: pytest.MonkeyPatch,
    endpoint: str,
):
    class FakeDatabaseConfig:
        type = "duckdb"
        allow_listed_only = False
        exclude_columns = []

        def __init__(self, name: str):
            self.name = name

        def get_database_name(self) -> str:
            return "shared"

    config = SimpleNamespace(
        databases=[
            FakeDatabaseConfig("first"),
            FakeDatabaseConfig("second"),
        ]
    )
    monkeypatch.setattr(
        main.NaoConfig,
        "try_load",
        staticmethod(lambda *args, **kwargs: config),
    )

    response = TestClient(app, headers=INTERNAL_HEADERS).post(
        endpoint,
        json={
            "sql": "SELECT 1",
            "nao_project_folder": "/unused",
            "database_id": "first",
            "table_access": UNENFORCED_TABLE_ACCESS,
        },
    )

    assert response.status_code == 400
    assert "authorization identity is ambiguous" in response.json()["detail"]


def test_duplicate_database_connection_names_are_rejected(
    monkeypatch: pytest.MonkeyPatch,
):
    config = SimpleNamespace(
        databases=[
            SimpleNamespace(name="duplicate", type="duckdb"),
            SimpleNamespace(name="duplicate", type="postgres"),
        ]
    )
    monkeypatch.setattr(
        main.NaoConfig,
        "try_load",
        staticmethod(lambda *args, **kwargs: config),
    )

    response = TestClient(app, headers=INTERNAL_HEADERS).post(
        "/execute_sql",
        json={
            "sql": "SELECT 1",
            "nao_project_folder": "/unused",
            "database_id": "duplicate",
            "table_access": UNENFORCED_TABLE_ACCESS,
        },
    )

    assert response.status_code == 400
    assert "connection names must be unique" in response.json()["detail"]


def test_sanitized_clickhouse_authorization_collision_is_rejected(
    monkeypatch: pytest.MonkeyPatch,
):
    config = SimpleNamespace(
        databases=[
            SimpleNamespace(
                name="analytics prod",
                type="clickhouse",
                allow_listed_only=False,
                exclude_columns=[],
            ),
            SimpleNamespace(
                name="analytics/prod",
                type="clickhouse",
                allow_listed_only=False,
                exclude_columns=[],
            ),
        ]
    )
    monkeypatch.setattr(
        main.NaoConfig,
        "try_load",
        staticmethod(lambda *args, **kwargs: config),
    )

    response = TestClient(app, headers=INTERNAL_HEADERS).post(
        "/validate_sql",
        json={
            "sql": "SELECT 1",
            "nao_project_folder": "/unused",
            "database_id": "analytics prod",
            "table_access": UNENFORCED_TABLE_ACCESS,
        },
    )

    assert response.status_code == 400
    assert "authorization identity is ambiguous" in response.json()["detail"]


def test_enforced_empty_access_allows_tableless_query(
    duckdb_project_with_excluded_columns,
):
    response = TestClient(app, headers=INTERNAL_HEADERS).post(
        "/execute_sql",
        json={
            "sql": "SELECT 1 AS value",
            "nao_project_folder": duckdb_project_with_excluded_columns,
            "table_access": {"enforced": True, "tables": []},
        },
    )

    assert response.status_code == 200, response.text


def test_table_access_is_filtered_to_active_database_folder(
    duckdb_project_with_excluded_columns,
):
    client = TestClient(app, headers=INTERNAL_HEADERS)
    request = {
        "sql": "SELECT name FROM users",
        "nao_project_folder": duckdb_project_with_excluded_columns,
        "table_access": {
            "enforced": True,
            "tables": [
                {
                    "database_type": "duckdb",
                    "database": "other",
                    "schema": "main",
                    "table": "users",
                }
            ],
        },
    }

    denied = client.post("/execute_sql", json=request)
    assert denied.status_code == 400
    assert "main.users" in denied.json()["detail"]

    request["table_access"]["tables"][0]["database"] = "test"
    allowed = client.post("/execute_sql", json=request)
    assert allowed.status_code == 200


def test_validate_sql_reuses_guards_without_executing(
    duckdb_project_with_excluded_columns,
):
    response = TestClient(app, headers=INTERNAL_HEADERS).post(
        "/validate_sql",
        json={
            "sql": "SELECT name FROM users",
            "nao_project_folder": duckdb_project_with_excluded_columns,
            "table_access": {
                "enforced": True,
                "tables": [
                    {
                        "database_type": "duckdb",
                        "database": "test",
                        "schema": "main",
                        "table": "users",
                    }
                ],
            },
        },
    )

    assert response.status_code == 200
    assert response.json() == {"valid": True, "dialect": "duckdb"}


@pytest.mark.parametrize("endpoint", ["/execute_sql", "/validate_sql"])
def test_motherduck_excluded_columns_apply_to_execute_and_validate(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
    endpoint: str,
):
    class MotherDuckDatabaseConfig:
        name = "motherduck"
        type = "motherduck"
        allow_listed_only = False
        exclude_columns = ["*.email"]

        def get_database_name(self) -> str:
            return "local"

        def column_matches_pattern(
            self, schema: str, table: str, column: str
        ) -> bool:
            return column != "email"

        def execute_sql(self, sql: str):
            assert sql == "SELECT 1 AS value"
            return main.pd.DataFrame([{"value": 1}])

    catalog_path = (
        tmp_path
        / ".meta/databases/type=motherduck/database=local/columns.json"
    )
    catalog_path.parent.mkdir(parents=True)
    catalog_path.write_text(
        json.dumps(
            {
                "version": 1,
                "schemas": {
                    "main": {
                        "users": [
                            {"name": "id", "type": "INTEGER"},
                            {"name": "email", "type": "VARCHAR"},
                        ]
                    }
                },
            }
        )
    )
    config = SimpleNamespace(databases=[MotherDuckDatabaseConfig()])
    monkeypatch.setattr(
        main.NaoConfig,
        "try_load",
        staticmethod(lambda *args, **kwargs: config),
    )
    client = TestClient(app, headers=INTERNAL_HEADERS)
    base_request = {
        "nao_project_folder": str(tmp_path),
        "table_access": UNENFORCED_TABLE_ACCESS,
        "enforce_excluded_columns": True,
    }

    tableless = client.post(
        endpoint,
        json={**base_request, "sql": "SELECT 1 AS value"},
    )
    assert tableless.status_code == 200, tableless.text

    guarded = client.post(
        endpoint,
        json={**base_request, "sql": "SELECT * FROM users"},
    )
    assert guarded.status_code == 400
    assert "main.users.email" in guarded.json()["detail"]


def test_execute_sql_simple_duckdb(duckdb_project_folder):
    """Test execute_sql endpoint with a DuckDB in-memory database."""
    client = TestClient(app, headers=INTERNAL_HEADERS)

    response = client.post(
        "/execute_sql",
        json={
            "sql": "SELECT 1 AS id, 'hello' AS message",
            "nao_project_folder": duckdb_project_folder,
            "table_access": UNENFORCED_TABLE_ACCESS,
        },
    )

    assert response.status_code == 200
    assert_sql_result(
        response.json(),
        row_count=1,
        columns=["id", "message"],
        expected_data=[{"id": 1, "message": "hello"}],
    )


def test_execute_sql_blocks_star_with_excluded_columns(
    duckdb_project_with_excluded_columns,
):
    client = TestClient(app, headers=INTERNAL_HEADERS)

    response = client.post(
        "/execute_sql",
        json={
            "sql": "SELECT * FROM users",
            "nao_project_folder": duckdb_project_with_excluded_columns,
            "table_access": UNENFORCED_TABLE_ACCESS,
            "enforce_excluded_columns": True,
        },
    )

    assert response.status_code == 400
    assert response.json()["detail"] == (
        "Query blocked because SELECT * would include excluded column(s): main.users.email. "
        "Use SELECT * EXCLUDE (email) to exclude them."
    )


def test_execute_sql_blocks_explicit_excluded_column(
    duckdb_project_with_excluded_columns,
):
    client = TestClient(app, headers=INTERNAL_HEADERS)

    response = client.post(
        "/execute_sql",
        json={
            "sql": "SELECT email FROM users",
            "nao_project_folder": duckdb_project_with_excluded_columns,
            "table_access": UNENFORCED_TABLE_ACCESS,
            "enforce_excluded_columns": True,
        },
    )

    assert response.status_code == 400
    assert "main.users.email" in response.json()["detail"]


@pytest.mark.parametrize(
    "enforce_excluded_columns", [False, None], ids=["disabled", "omitted"]
)
def test_execute_sql_allows_excluded_column_without_enforcement(
    duckdb_project_with_excluded_columns,
    enforce_excluded_columns,
):
    client = TestClient(app, headers=INTERNAL_HEADERS)
    request = {
        "sql": "SELECT email FROM users",
        "nao_project_folder": duckdb_project_with_excluded_columns,
        "table_access": UNENFORCED_TABLE_ACCESS,
    }
    if enforce_excluded_columns is not None:
        request["enforce_excluded_columns"] = enforce_excluded_columns

    response = client.post("/execute_sql", json=request)

    assert response.status_code == 200
    assert_sql_result(
        response.json(),
        row_count=1,
        columns=["email"],
        expected_data=[{"email": "alice@example.com"}],
    )


def test_execute_sql_allows_table_present_in_synced_context(
    duckdb_project_with_listed_tables_only,
):
    client = TestClient(app, headers=INTERNAL_HEADERS)

    response = client.post(
        "/execute_sql",
        json={
            "sql": "SELECT * FROM orders",
            "nao_project_folder": duckdb_project_with_listed_tables_only,
            "table_access": UNENFORCED_TABLE_ACCESS,
        },
    )

    assert response.status_code == 200
    assert_sql_result(
        response.json(),
        row_count=1,
        columns=["id", "total"],
        expected_data=[{"id": 1, "total": 25}],
    )


def test_execute_sql_blocks_table_missing_from_synced_context(
    duckdb_project_with_listed_tables_only,
):
    client = TestClient(app, headers=INTERNAL_HEADERS)

    response = client.post(
        "/execute_sql",
        json={
            "sql": "SELECT * FROM users",
            "nao_project_folder": duckdb_project_with_listed_tables_only,
            "table_access": UNENFORCED_TABLE_ACCESS,
        },
    )

    assert response.status_code == 400
    detail = response.json()["detail"]
    assert "allow_listed_only is enabled" in detail
    assert "Unlisted table(s): main.users" in detail
    assert "Only synced context tables are allowed - list/read context to see them." in detail


def test_azure_entra_tableless_query_does_not_require_sync_credentials(
    monkeypatch: pytest.MonkeyPatch,
):
    class AzureDatabaseConfig:
        name = "test-redshift"
        type = "redshift"
        auth_mode = SimpleNamespace(value="azure_entra_id")
        user = None
        password = None
        allow_listed_only = True
        exclude_columns = ["*.secret"]

        def get_database_name(self) -> str:
            return "analytics"

        def execute_sql_with_token(self, sql: str, access_token: str):
            assert sql == "SELECT 1 AS value"
            assert access_token == "token"
            return main.pd.DataFrame([{"value": 1}])

    config = SimpleNamespace(databases=[AzureDatabaseConfig()])
    monkeypatch.setattr(
        main.NaoConfig,
        "try_load",
        staticmethod(lambda *args, **kwargs: config),
    )

    response = TestClient(app, headers=INTERNAL_HEADERS).post(
        "/execute_sql",
        json={
            "sql": "SELECT 1 AS value",
            "nao_project_folder": "/unused",
            "table_access": UNENFORCED_TABLE_ACCESS,
            "azure_access_token": "token",
        },
    )

    assert response.status_code == 200
    assert_sql_result(
        response.json(),
        row_count=1,
        columns=["value"],
        expected_data=[{"value": 1}],
    )


def test_execute_sql_with_cte_duckdb(duckdb_project_folder):
    """Test execute_sql endpoint with a DuckDB in-memory database."""
    client = TestClient(app, headers=INTERNAL_HEADERS)

    response = client.post(
        "/execute_sql",
        json={
            "sql": "WITH test AS (SELECT 1 AS id, 'hello' AS message) SELECT * FROM test",
            "nao_project_folder": duckdb_project_folder,
            "table_access": UNENFORCED_TABLE_ACCESS,
        },
    )

    assert response.status_code == 200
    assert_sql_result(
        response.json(),
        row_count=1,
        columns=["id", "message"],
        expected_data=[{"id": 1, "message": "hello"}],
    )


# BigQuery tests (requires SSO authentication)


@pytest.fixture
def bigquery_project_folder():
    """Create a temporary project folder with a BigQuery config using SSO."""
    with tempfile.TemporaryDirectory() as tmpdir:
        config = {
            "project_name": "test-project",
            "databases": [
                {
                    "name": "nao-bigquery",
                    "type": "bigquery",
                    "project_id": "nao-corp",
                    "sso": True,
                }
            ],
        }
        config_path = Path(tmpdir) / "nao_config.yaml"
        with config_path.open("w") as f:
            yaml.dump(config, f)
        yield tmpdir


def test_execute_sql_simple_bigquery(bigquery_project_folder):
    """Test execute_sql endpoint with BigQuery using SSO."""
    client = TestClient(app, headers=INTERNAL_HEADERS)

    response = client.post(
        "/execute_sql",
        json={
            "sql": "SELECT 1 AS id, 'hello' AS message",
            "nao_project_folder": bigquery_project_folder,
            "table_access": UNENFORCED_TABLE_ACCESS,
        },
    )

    assert response.status_code == 200, response.text
    assert_sql_result(
        response.json(),
        row_count=1,
        columns=["id", "message"],
        expected_data=[{"id": 1, "message": "hello"}],
    )


def test_execute_sql_with_cte_bigquery(bigquery_project_folder):
    """Test execute_sql endpoint with a CTE query on BigQuery."""
    client = TestClient(app, headers=INTERNAL_HEADERS)

    cte_sql = """
    WITH users AS (
        SELECT 1 AS id, 'Alice' AS name
        UNION ALL SELECT 2, 'Bob'
        UNION ALL SELECT 3, 'Charlie'
    )
    SELECT * FROM users
    """

    response = client.post(
        "/execute_sql",
        json={
            "sql": cte_sql,
            "nao_project_folder": bigquery_project_folder,
            "table_access": UNENFORCED_TABLE_ACCESS,
        },
    )

    assert response.status_code == 200, response.text
    assert_sql_result(
        response.json(),
        row_count=3,
        columns=["id", "name"],
        expected_data=[
            {"id": 1, "name": "Alice"},
            {"id": 2, "name": "Bob"},
            {"id": 3, "name": "Charlie"},
        ],
    )
