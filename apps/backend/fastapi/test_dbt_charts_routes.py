import tempfile
from pathlib import Path

import duckdb
import pytest
import yaml
from fastapi.testclient import TestClient
from main import app

from nao_core.dbt_charts import is_available

INTERNAL_SECRET = "test-internal-secret-at-least-20-characters"
INTERNAL_HEADERS = {"X-Nao-Internal-Secret": INTERNAL_SECRET}

requires_dbt_charts = pytest.mark.skipif(
    not is_available(), reason="dbt-charts is not installed"
)

BOARD = """
title: Orders board
variables:
  status:
    input: multiselect
    column: orders.status
queries:
  by_status: |
    SELECT status, count(*) AS orders FROM orders
    WHERE {{ filter('status', status) }}
    GROUP BY 1 ORDER BY 1
charts:
  statuses:
    type: bar
    query: by_status
    x: status
    y: orders
"""


@pytest.fixture(autouse=True)
def internal_secret(monkeypatch):
    monkeypatch.setenv("BETTER_AUTH_SECRET", INTERNAL_SECRET)


@pytest.fixture
def client():
    return TestClient(app, headers=INTERNAL_HEADERS)


@pytest.fixture
def orders_project_folder():
    with tempfile.TemporaryDirectory() as tmpdir:
        database_path = Path(tmpdir) / "test.duckdb"
        conn = duckdb.connect(str(database_path))
        conn.execute("CREATE TABLE orders (id INTEGER, status VARCHAR, secret VARCHAR)")
        conn.execute(
            "INSERT INTO orders VALUES (1, 'completed', 'x'), (2, 'completed', 'y'), (3, 'returned', 'z')"
        )
        conn.close()

        config = {
            "project_name": "test-project",
            "databases": [
                {
                    "name": "test-duckdb",
                    "type": "duckdb",
                    "path": str(database_path),
                    "exclude_columns": ["*.secret"],
                }
            ],
        }
        (Path(tmpdir) / "nao_config.yaml").write_text(yaml.dump(config))
        yield tmpdir


def test_status_reports_availability(client):
    response = client.get("/dbt_charts/status")
    assert response.status_code == 200
    body = response.json()
    assert body["available"] == is_available()
    if body["available"]:
        assert body["version"]
    else:
        assert "nao-core[dbt-charts]" in body["install_hint"]


def test_dbt_charts_routes_require_internal_secret():
    response = TestClient(app).get("/dbt_charts/status")
    assert response.status_code == 401


@requires_dbt_charts
def test_validate_reports_compile_errors(client, orders_project_folder):
    response = client.post(
        "/dbt_charts/validate",
        json={
            "yaml": "charts:\n  bad:\n    type: bar\n    query: missing\n    x: a\n    y: b\n",
            "nao_project_folder": orders_project_folder,
        },
    )
    assert response.status_code == 200
    body = response.json()
    assert body["success"] is False
    assert body["errors"]


@requires_dbt_charts
def test_validate_accepts_a_board(client, orders_project_folder):
    response = client.post(
        "/dbt_charts/validate",
        json={"yaml": BOARD, "nao_project_folder": orders_project_folder},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["success"] is True
    assert body["title"] == "Orders board"


@requires_dbt_charts
def test_render_runs_queries_through_nao_and_returns_svg(client, orders_project_folder):
    response = client.post(
        "/dbt_charts/render",
        json={
            "yaml": BOARD,
            "nao_project_folder": orders_project_folder,
            "variables": {"status": ["completed"]},
            "font_url_prefix": "/api/dbt-charts/fonts",
        },
    )
    assert response.status_code == 200
    body = response.json()
    assert body["board_error"] is None
    assert body["chart_errors"] == []
    assert body["title"] == "Orders board"
    assert body["svg"].lstrip().startswith("<svg")
    assert "/api/dbt-charts/fonts/" in body["svg"]

    [control] = body["controls"]
    assert control["name"] == "status"
    assert control["input"] == "multiselect"
    assert control["options"] == ["completed", "returned"]
    assert control["value"] == ["completed"]


@requires_dbt_charts
def test_render_surfaces_guard_errors_as_chart_errors(client, orders_project_folder):
    board = BOARD.replace(
        "SELECT status, count(*) AS orders", "SELECT status, secret, count(*) AS orders"
    ).replace("GROUP BY 1 ORDER BY 1", "GROUP BY 1, 2 ORDER BY 1")
    response = client.post(
        "/dbt_charts/render",
        json={
            "yaml": board,
            "nao_project_folder": orders_project_folder,
            "enforce_excluded_columns": True,
        },
    )
    assert response.status_code == 200
    body = response.json()
    assert body["chart_errors"]
    assert "secret" in body["chart_errors"][0]["message"]


@requires_dbt_charts
def test_fonts_are_served_from_the_dbt_charts_bundle(client):
    response = client.get("/dbt_charts/fonts/nope.woff2")
    assert response.status_code == 404
    response = client.get("/dbt_charts/fonts/../main.py")
    assert response.status_code in (404, 422)
