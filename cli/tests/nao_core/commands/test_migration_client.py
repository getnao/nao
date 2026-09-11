from unittest.mock import Mock

import pytest

from nao_core.commands import migration_client


def test_client_reauthenticates_once_after_expired_session(monkeypatch):
    expired = Mock()
    expired.request.return_value = Mock(status_code=401, ok=False, text="Unauthorized")
    fresh = Mock()
    fresh.request.return_value = Mock(status_code=200, ok=True, json=lambda: {"collections": []})
    sessions = iter([expired, fresh])

    get_auth_session = Mock(side_effect=sessions)
    monkeypatch.setattr(migration_client, "get_auth_session", get_auth_session)
    reauthenticate = Mock(return_value=True)
    monkeypatch.setattr(migration_client, "reauthenticate", reauthenticate)
    monkeypatch.setenv("NAO_USERNAME", "agent@example.com")
    monkeypatch.setenv("NAO_PASSWORD", "secret")

    client = migration_client.MigrationClient(
        "http://localhost:5005",
        project_id="project-1",
        noninteractive=True,
    )

    assert client.request("GET", "/collections") == {"collections": []}
    reauthenticate.assert_called_once_with(
        "http://localhost:5005",
        "agent@example.com",
        "secret",
        prompt_if_missing=False,
        quiet=True,
        timeout=migration_client.HTTP_TIMEOUT,
    )
    assert get_auth_session.call_args_list[0].kwargs == {
        "prompt_if_missing": False,
        "email": "agent@example.com",
        "password": "secret",
        "quiet": True,
        "timeout": migration_client.HTTP_TIMEOUT,
    }
    assert get_auth_session.call_args_list[1].kwargs == {
        "prompt_if_missing": False,
        "quiet": True,
        "timeout": migration_client.HTTP_TIMEOUT,
    }
    assert expired.request.call_args.kwargs["headers"] == {"x-nao-project-id": "project-1"}
    assert expired.request.call_args.kwargs["timeout"] == migration_client.HTTP_TIMEOUT
    assert expired.request.call_count == 1
    assert fresh.request.call_count == 1


def test_client_reports_auth_http_and_response_contract_failures(monkeypatch):
    session = Mock()
    monkeypatch.setattr(migration_client, "get_auth_session", lambda *args, **kwargs: session)
    monkeypatch.setattr(migration_client, "reauthenticate", Mock(return_value=False))
    client = migration_client.MigrationClient("http://localhost:5005")

    session.request.return_value = Mock(status_code=401, ok=False, text="Unauthorized")
    with pytest.raises(migration_client.MigrationError, match="Unauthorized"):
        client.request("GET", "/collections")

    session.request.return_value = Mock(
        status_code=400,
        ok=False,
        text="Bad request",
        json=lambda: {"error": "ambiguous_server"},
    )
    with pytest.raises(migration_client.MigrationError, match="400.*ambiguous_server"):
        client.request("GET", "/collections")

    session.request.return_value = Mock(status_code=200, ok=True, json=lambda: [])
    with pytest.raises(migration_client.MigrationError, match="unexpected response"):
        client.request("GET", "/collections")


def test_client_uses_project_id_environment_fallback(monkeypatch):
    session = Mock()
    session.request.return_value = Mock(status_code=200, ok=True, json=lambda: {"collections": []})
    monkeypatch.setattr(migration_client, "get_auth_session", Mock(return_value=session))
    monkeypatch.setenv("NAO_PROJECT_ID", "environment-project")

    migration_client.MigrationClient().request("GET", "/collections")

    assert session.request.call_args.kwargs["headers"] == {"x-nao-project-id": "environment-project"}
