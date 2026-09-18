import json
import threading
from pathlib import Path
from unittest.mock import MagicMock, patch
from urllib.parse import parse_qs, urlparse
from urllib.request import urlopen

import pytest
import requests

from nao_core import auth


@pytest.fixture(autouse=True)
def isolated_auth_file(tmp_path: Path, monkeypatch):
    monkeypatch.setattr(auth, "AUTH_FILE", tmp_path / "auth.json")


def test_token_storage_round_trip():
    assert auth.get_stored_token() is None

    auth.store_token("my-token")
    assert auth.get_stored_token() == "my-token"

    auth.clear_stored_auth()
    assert auth.get_stored_token() is None


def test_stored_cookies_still_readable():
    auth.AUTH_FILE.parent.mkdir(parents=True, exist_ok=True)
    auth.AUTH_FILE.write_text(json.dumps({"cookies": {"session": "abc"}}))

    assert auth.get_stored_cookies() == {"session": "abc"}
    assert auth.get_stored_token() is None


def test_apply_stored_auth_prefers_bearer_token():
    auth.store_token("my-token")
    session = requests.Session()

    assert auth.apply_stored_auth(session) is True
    assert session.headers["Authorization"] == "Bearer my-token"


def test_apply_stored_auth_falls_back_to_cookies():
    auth.store_cookies({"session": "abc"})
    session = requests.Session()

    assert auth.apply_stored_auth(session) is True
    assert session.cookies.get("session") == "abc"


def test_apply_stored_auth_without_credentials():
    assert auth.apply_stored_auth(requests.Session()) is False


def _open_browser_and_callback(query_builder):
    """Simulate the browser: hit the CLI callback with the given query params."""

    def fake_open(url: str) -> bool:
        params = parse_qs(urlparse(url).query)
        port = params["port"][0]
        state = params["state"][0]

        def callback():
            try:
                urlopen(f"http://127.0.0.1:{port}/callback?{query_builder(state)}")
            except OSError:
                pass

        threading.Thread(target=callback, daemon=True).start()
        return True

    return fake_open


@patch("nao_core.auth.requests.post")
@patch("nao_core.auth.webbrowser.open")
def test_browser_login_success(mock_open, mock_post):
    mock_open.side_effect = _open_browser_and_callback(lambda state: f"code=one-time-code&state={state}")
    mock_post.return_value = MagicMock(status_code=200, json=lambda: {"token": "session-token"})

    token = auth.browser_login("http://localhost:5005", timeout=10)

    assert token == "session-token"
    assert auth.get_stored_token() == "session-token"
    mock_post.assert_called_once_with(
        "http://localhost:5005/api/cli-auth/token",
        json={"code": "one-time-code"},
    )


@patch("nao_core.auth.requests.post")
@patch("nao_core.auth.webbrowser.open")
def test_browser_login_denied(mock_open, mock_post):
    mock_open.side_effect = _open_browser_and_callback(lambda state: f"error=access_denied&state={state}")

    assert auth.browser_login("http://localhost:5005", timeout=10) is None
    assert auth.get_stored_token() is None
    mock_post.assert_not_called()


@patch("nao_core.auth.requests.post")
@patch("nao_core.auth.webbrowser.open")
def test_browser_login_rejects_invalid_state(mock_open, mock_post):
    mock_open.side_effect = _open_browser_and_callback(lambda state: "code=stolen-code&state=wrong-state")

    assert auth.browser_login("http://localhost:5005", timeout=1) is None
    mock_post.assert_not_called()


@patch("nao_core.auth.webbrowser.open")
def test_browser_login_returns_none_when_browser_unavailable(mock_open):
    mock_open.return_value = False

    assert auth.browser_login("http://localhost:5005", timeout=10) is None


@patch("nao_core.auth.requests.post")
@patch("nao_core.auth.webbrowser.open")
def test_browser_login_exchange_failure(mock_open, mock_post):
    mock_open.side_effect = _open_browser_and_callback(lambda state: f"code=expired-code&state={state}")
    mock_post.return_value = MagicMock(status_code=400)

    assert auth.browser_login("http://localhost:5005", timeout=10) is None
    assert auth.get_stored_token() is None
