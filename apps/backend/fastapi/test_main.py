import json
import tempfile
from pathlib import Path

import duckdb
import pytest
import yaml
from fastapi.testclient import TestClient
from main import app

INTERNAL_SECRET = "test-internal-secret-at-least-20-characters"
INTERNAL_HEADERS = {"X-Nao-Internal-Secret": INTERNAL_SECRET}


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
        catalog_path = Path(tmpdir) / ".meta" / "databases" / "type=duckdb" / "database=test" / "columns.json"
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


def test_health_does_not_require_internal_secret():
    response = TestClient(app).get("/health")

    assert response.status_code == 200


@pytest.mark.parametrize("headers", [{}, {"X-Nao-Internal-Secret": "wrong-secret"}])
def test_internal_routes_reject_missing_or_wrong_secret(headers):
    response = TestClient(app).post(
        "/execute_sql",
        headers=headers,
        json={"sql": "SELECT 1", "nao_project_folder": "/tmp"},
    )

    assert response.status_code == 401


def test_internal_routes_fail_closed_without_configured_secret(monkeypatch):
    monkeypatch.delenv("BETTER_AUTH_SECRET")

    response = TestClient(app, headers=INTERNAL_HEADERS).post(
        "/execute_sql", json={"sql": "SELECT 1", "nao_project_folder": "/tmp"}
    )

    assert response.status_code == 503


def test_execute_sql_simple_duckdb(duckdb_project_folder):
    """Test execute_sql endpoint with a DuckDB in-memory database."""
    client = TestClient(app, headers=INTERNAL_HEADERS)

    response = client.post(
        "/execute_sql",
        json={
            "sql": "SELECT 1 AS id, 'hello' AS message",
            "nao_project_folder": duckdb_project_folder,
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


def test_execute_sql_with_cte_duckdb(duckdb_project_folder):
    """Test execute_sql endpoint with a DuckDB in-memory database."""
    client = TestClient(app, headers=INTERNAL_HEADERS)

    response = client.post(
        "/execute_sql",
        json={
            "sql": "WITH test AS (SELECT 1 AS id, 'hello' AS message) SELECT * FROM test",
            "nao_project_folder": duckdb_project_folder,
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
        },
    )

    assert response.status_code == 200
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
        },
    )

    assert response.status_code == 200
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
