import os
import tempfile
from pathlib import Path

import pytest
import yaml
from fastapi.testclient import TestClient
from main import app

TEST_INTERNAL_SECRET = "test-internal-secret-at-least-20-characters"
os.environ["BETTER_AUTH_SECRET"] = TEST_INTERNAL_SECRET

AUTH_HEADERS = {"X-Nao-Internal-Secret": TEST_INTERNAL_SECRET}


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


def test_execute_sql_simple_duckdb(duckdb_project_folder):
    """Test execute_sql endpoint with a DuckDB in-memory database."""
    client = TestClient(app)

    response = client.post(
        "/execute_sql",
        headers=AUTH_HEADERS,
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


def test_execute_sql_with_cte_duckdb(duckdb_project_folder):
    """Test execute_sql endpoint with a DuckDB in-memory database."""
    client = TestClient(app)

    response = client.post(
        "/execute_sql",
        headers=AUTH_HEADERS,
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


def test_health_does_not_require_internal_auth():
    response = TestClient(app).get("/health")

    assert response.status_code == 200


@pytest.mark.parametrize(
    "headers",
    [
        {},
        {"X-Nao-Internal-Secret": "incorrect-secret-at-least-20-characters"},
    ],
)
def test_execute_sql_requires_internal_auth(duckdb_project_folder, headers):
    response = TestClient(app).post(
        "/execute_sql",
        headers=headers,
        json={
            "sql": "SELECT 1",
            "nao_project_folder": duckdb_project_folder,
        },
    )

    assert response.status_code == 401


def test_execute_sql_fails_closed_without_configured_secret(
    duckdb_project_folder,
    monkeypatch,
):
    monkeypatch.delenv("BETTER_AUTH_SECRET")

    response = TestClient(app).post(
        "/execute_sql",
        headers=AUTH_HEADERS,
        json={
            "sql": "SELECT 1",
            "nao_project_folder": duckdb_project_folder,
        },
    )

    assert response.status_code == 503


def test_refresh_requires_internal_auth():
    response = TestClient(app).post("/api/refresh")

    assert response.status_code == 401


@pytest.mark.parametrize(
    "sql",
    [
        "DELETE FROM users",
        "SELECT 1; DROP TABLE users",
        "WITH deleted AS (DELETE FROM users RETURNING *) SELECT * FROM deleted",
        "SELECT * INTO copied_users FROM users",
        "SELECT * FROM users FOR UPDATE",
        "SELECT (",
    ],
)
def test_execute_sql_rejects_non_read_only_sql(duckdb_project_folder, sql):
    response = TestClient(app).post(
        "/execute_sql",
        headers=AUTH_HEADERS,
        json={
            "sql": sql,
            "nao_project_folder": duckdb_project_folder,
        },
    )

    assert response.status_code == 403
    assert response.json()["detail"] == "Write SQL operations are disabled"


def test_execute_sql_allows_authenticated_write_permission(monkeypatch):
    class FakeDatabase:
        name = "test"
        type = "duckdb"
        auth_mode = None

        def execute_sql(self, sql):
            import pandas as pd

            assert sql == "DELETE FROM users"
            return pd.DataFrame()

    class FakeConfig:
        databases = [FakeDatabase()]

    monkeypatch.setattr(
        "main.NaoConfig.try_load",
        lambda *args, **kwargs: FakeConfig(),
    )

    response = TestClient(app).post(
        "/execute_sql",
        headers=AUTH_HEADERS,
        json={
            "sql": "DELETE FROM users",
            "nao_project_folder": "/tmp/test-project",
            "dangerously_write_permission_enabled": True,
        },
    )

    assert response.status_code == 200


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
    client = TestClient(app)

    response = client.post(
        "/execute_sql",
        headers=AUTH_HEADERS,
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
    client = TestClient(app)

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
        headers=AUTH_HEADERS,
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
