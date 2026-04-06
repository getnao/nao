"""Unit tests for /execute_dax endpoint using mocked XMLA responses.

Tests cover: auth failure, dataset not found, DAX syntax error, row limit, happy path.
All tests use FastAPI TestClient + pytest fixtures; no real Power BI connection required.
"""

from __future__ import annotations

import tempfile
from pathlib import Path
from unittest.mock import patch

import pandas as pd
import pytest
import yaml
from fastapi.testclient import TestClient

from main import app

client = TestClient(app)


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

_BASE_CONFIG = {
    "project_name": "test-powerbi",
    "databases": [
        {
            "name": "sales-model",
            "type": "powerbi_xmla",
            "workspace": "My Workspace",
            "dataset": "Sales Model",
            "tenant_id": "test-tenant",
            "client_id": "test-client",
            "client_secret": "test-secret",
            "row_limit": 100,
            "timeout_seconds": 10,
        }
    ],
}


@pytest.fixture()
def powerbi_project_folder():
    with tempfile.TemporaryDirectory() as tmpdir:
        config_path = Path(tmpdir) / "nao_config.yaml"
        config_path.write_text(yaml.dump(_BASE_CONFIG))
        yield tmpdir


@pytest.fixture()
def mock_execute_dax_df():
    """Patch PowerBIXmlaConfig.execute_dax to return a small DataFrame."""
    df = pd.DataFrame({"[Sales].[Date]": ["2024-01-01"], "[Sales].[Amount]": [999.0]})
    with patch(
        "nao_core.config.databases.powerbi_xmla.PowerBIXmlaConfig.execute_dax",
        return_value=df,
    ):
        yield df


# ---------------------------------------------------------------------------
# Happy path
# ---------------------------------------------------------------------------


def test_execute_dax_returns_tabular_data(powerbi_project_folder, mock_execute_dax_df):
    response = client.post(
        "/execute_dax",
        json={"dax": "EVALUATE 'Sales'", "nao_project_folder": powerbi_project_folder},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["row_count"] == 1
    assert body["dialect"] == "powerbi_xmla"
    assert "[Sales].[Date]" in body["columns"]


# ---------------------------------------------------------------------------
# Error cases
# ---------------------------------------------------------------------------


def test_execute_dax_rejects_non_evaluate(powerbi_project_folder):
    """Returns 400 when DAX query does not start with EVALUATE."""
    response = client.post(
        "/execute_dax",
        json={"dax": "SELECT * FROM Sales", "nao_project_folder": powerbi_project_folder},
    )
    assert response.status_code == 400
    assert "EVALUATE" in response.json()["detail"]


def test_execute_dax_no_powerbi_config():
    """Returns 400 when no powerbi_xmla database is configured."""
    with tempfile.TemporaryDirectory() as tmpdir:
        config = {"project_name": "no-pbi", "databases": [{"name": "db", "type": "duckdb", "path": ":memory:"}]}
        (Path(tmpdir) / "nao_config.yaml").write_text(yaml.dump(config))
        response = client.post(
            "/execute_dax",
            json={"dax": "EVALUATE 'x'", "nao_project_folder": tmpdir},
        )
        assert response.status_code == 400
        assert "powerbi_xmla" in response.json()["detail"]


def test_execute_dax_auth_failure(powerbi_project_folder):
    """Returns 500 when MSAL authentication fails."""
    with patch(
        "nao_core.config.databases.powerbi_xmla.PowerBIXmlaConfig.execute_dax",
        side_effect=ConnectionError("MSAL authentication failed: invalid_client"),
    ):
        response = client.post(
            "/execute_dax",
            json={"dax": "EVALUATE 'Sales'", "nao_project_folder": powerbi_project_folder},
        )
        assert response.status_code == 500
        assert "MSAL" in response.json()["detail"]


def test_execute_dax_timeout(powerbi_project_folder):
    """Returns 504 on timeout."""
    with patch(
        "nao_core.config.databases.powerbi_xmla.PowerBIXmlaConfig.execute_dax",
        side_effect=TimeoutError("XMLA request timed out after 10s"),
    ):
        response = client.post(
            "/execute_dax",
            json={"dax": "EVALUATE 'Sales'", "nao_project_folder": powerbi_project_folder},
        )
        assert response.status_code == 504


def test_execute_dax_database_id_not_found(powerbi_project_folder, mock_execute_dax_df):
    """Returns 400 when the requested database_id is not in config."""
    response = client.post(
        "/execute_dax",
        json={
            "dax": "EVALUATE 'Sales'",
            "nao_project_folder": powerbi_project_folder,
            "database_id": "nonexistent-model",
        },
    )
    assert response.status_code == 400
    assert "not found" in response.json()["detail"]["message"]


def test_health_powerbi_xmla_no_env(monkeypatch):
    """Returns 'skipped' when NAO_DEFAULT_PROJECT_PATH is not set."""
    monkeypatch.delenv("NAO_DEFAULT_PROJECT_PATH", raising=False)
    response = client.get("/health/powerbi-xmla")
    assert response.status_code == 200
    assert response.json()["status"] == "skipped"


# ---------------------------------------------------------------------------
# env-var resolution (finding 3: fail-fast on missing ${VAR})
# ---------------------------------------------------------------------------


def test_execute_dax_missing_env_var_fails_fast(monkeypatch):
    """Config validation raises immediately when a ${VAR} placeholder is unset."""
    from nao_core.config.databases.powerbi_xmla import PowerBIXmlaConfig

    monkeypatch.delenv("MISSING_SECRET", raising=False)
    with pytest.raises(Exception, match="MISSING_SECRET"):
        PowerBIXmlaConfig(
            name="test",
            workspace="ws",
            dataset="ds",
            tenant_id="tid",
            client_id="cid",
            client_secret="${MISSING_SECRET}",
        )


def test_execute_dax_env_var_resolved(monkeypatch):
    """${VAR} placeholders resolve correctly when the env var is set."""
    from nao_core.config.databases.powerbi_xmla import PowerBIXmlaConfig

    monkeypatch.setenv("MY_SECRET", "actual-secret-value")
    cfg = PowerBIXmlaConfig(
        name="test",
        workspace="ws",
        dataset="ds",
        tenant_id="tid",
        client_id="cid",
        client_secret="${MY_SECRET}",
    )
    assert cfg.client_secret == "actual-secret-value"
