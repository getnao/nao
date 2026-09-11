from unittest.mock import Mock

import pytest

from nao_core.commands import migration_client


def test_client_reauthenticates_once_after_expired_session(monkeypatch):
    expired = Mock()
    expired.request.return_value = Mock(status_code=401, ok=False, text="Unauthorized")
    fresh = Mock()
    fresh.request.return_value = Mock(status_code=200, ok=True, json=lambda: {"collections": []})
    sessions = iter([expired, fresh])

    monkeypatch.setattr(migration_client, "get_auth_session", lambda *args, **kwargs: next(sessions))
    reauthenticate = Mock(return_value=True)
    monkeypatch.setattr(migration_client, "reauthenticate", reauthenticate)

    client = migration_client.DashboardMigrationClient("http://localhost:5005")

    assert client.request("GET", "/collections") == {"collections": []}
    reauthenticate.assert_called_once_with("http://localhost:5005")
    assert expired.request.call_count == 1
    assert fresh.request.call_count == 1


def test_client_reports_auth_http_and_response_contract_failures(monkeypatch):
    session = Mock()
    monkeypatch.setattr(migration_client, "get_auth_session", lambda *args, **kwargs: session)
    monkeypatch.setattr(migration_client, "reauthenticate", Mock(return_value=False))
    client = migration_client.DashboardMigrationClient("http://localhost:5005")

    session.request.return_value = Mock(status_code=401, ok=False, text="Unauthorized")
    with pytest.raises(migration_client.DashboardMigrationClientError, match="Unauthorized"):
        client.request("GET", "/collections")

    session.request.return_value = Mock(
        status_code=400,
        ok=False,
        text="Bad request",
        json=lambda: {"error": "ambiguous_server"},
    )
    with pytest.raises(migration_client.DashboardMigrationClientError, match="400.*ambiguous_server"):
        client.request("GET", "/collections")

    session.request.return_value = Mock(status_code=200, ok=True, json=lambda: [])
    with pytest.raises(migration_client.DashboardMigrationClientError, match="unexpected response"):
        client.request("GET", "/collections")
