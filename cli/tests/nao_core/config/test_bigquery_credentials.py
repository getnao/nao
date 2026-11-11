from unittest.mock import MagicMock, patch

import pytest

from nao_core.config.databases.bigquery import BigQueryConfig, BigQueryServiceAccountRequired


@pytest.fixture
def ibis_connect():
    pytest.importorskip("ibis.backends.bigquery")
    with patch("ibis.bigquery.connect", return_value=MagicMock()) as connect:
        yield connect


def test_cloud_refuses_ambient_credentials_for_sso_connection(monkeypatch, ibis_connect):
    monkeypatch.setenv("NAO_MODE", "cloud")
    config = BigQueryConfig(name="customer-bq", project_id="customer-project", sso=True)

    with pytest.raises(BigQueryServiceAccountRequired, match="credentials_json"):
        config.connect()

    ibis_connect.assert_not_called()


def test_cloud_refuses_ambient_credentials_without_any_credentials(monkeypatch, ibis_connect):
    monkeypatch.setenv("NAO_MODE", "cloud")
    config = BigQueryConfig(name="customer-bq", project_id="customer-project")

    with pytest.raises(BigQueryServiceAccountRequired):
        config.connect()

    ibis_connect.assert_not_called()


def test_cloud_connects_with_a_service_account(monkeypatch, ibis_connect):
    monkeypatch.setenv("NAO_MODE", "cloud")
    service_account_credentials = MagicMock()
    config = BigQueryConfig(name="customer-bq", project_id="customer-project", credentials_json={"type": "x"})

    with patch(
        "google.oauth2.service_account.Credentials.from_service_account_info",
        return_value=service_account_credentials,
    ):
        config.connect()

    assert ibis_connect.call_args.kwargs["credentials"] is service_account_credentials


def test_outside_cloud_sso_keeps_application_default_credentials_flow(monkeypatch, ibis_connect):
    monkeypatch.delenv("NAO_MODE", raising=False)
    config = BigQueryConfig(name="local-bq", project_id="my-project", sso=True)

    config.connect()

    kwargs = ibis_connect.call_args.kwargs
    assert "credentials" not in kwargs
    assert kwargs["auth_local_webserver"] is True
