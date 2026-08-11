import tempfile
from pathlib import Path
from types import SimpleNamespace

import duckdb
import main
import pytest
import yaml
from fastapi.testclient import TestClient
from main import app


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


def test_execute_sql_blocks_star_with_excluded_columns(
    duckdb_project_with_excluded_columns,
):
    client = TestClient(app)

    response = client.post(
        "/execute_sql",
        json={
            "sql": "SELECT * FROM users",
            "nao_project_folder": duckdb_project_with_excluded_columns,
        },
    )

    assert response.status_code == 400
    assert response.json()["detail"] == (
        "Query blocked because SELECT * would include excluded column(s): main.users.email. "
        "Select only allowed columns explicitly instead of using *."
    )


def test_execute_sql_blocks_explicit_excluded_column(
    duckdb_project_with_excluded_columns,
):
    client = TestClient(app)

    response = client.post(
        "/execute_sql",
        json={
            "sql": "SELECT email FROM users",
            "nao_project_folder": duckdb_project_with_excluded_columns,
        },
    )

    assert response.status_code == 400
    assert "main.users.email" in response.json()["detail"]


def test_execute_sql_allows_table_present_in_synced_context(
    duckdb_project_with_listed_tables_only,
):
    client = TestClient(app)

    response = client.post(
        "/execute_sql",
        json={
            "sql": "SELECT * FROM orders",
            "nao_project_folder": duckdb_project_with_listed_tables_only,
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
    client = TestClient(app)

    response = client.post(
        "/execute_sql",
        json={
            "sql": "SELECT * FROM users",
            "nao_project_folder": duckdb_project_with_listed_tables_only,
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

    response = TestClient(app).post(
        "/execute_sql",
        json={
            "sql": "SELECT 1 AS value",
            "nao_project_folder": "/unused",
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
