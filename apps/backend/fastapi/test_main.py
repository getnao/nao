import tempfile
from pathlib import Path

import pytest
import yaml
from fastapi.testclient import TestClient

from main import app


def assert_sql_result(data: dict, *, row_count: int, columns: list[str], expected_data: list[dict]):
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
    client = TestClient(app)

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