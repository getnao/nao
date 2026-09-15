"""Authentication utilities for nao CLI."""

import json
import secrets
import threading
import time
import webbrowser
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlencode, urlparse

import requests

from nao_core.ui import UI, ask_text

# Store credentials in user's home directory
AUTH_FILE = Path.home() / ".nao" / "auth.json"

BROWSER_LOGIN_TIMEOUT_SECONDS = 300

CALLBACK_SUCCESS_PAGE = """<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <title>nao CLI</title>
    <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
               background: #0f0f0f; color: #e5e5e5; display: flex; align-items: center;
               justify-content: center; height: 100vh; margin: 0; }
        .card { text-align: center; }
        h1 { font-size: 1.25rem; color: #fff; }
        p { color: #888; }
    </style>
</head>
<body>
    <div class="card">
        <h1>{title}</h1>
        <p>{message}</p>
    </div>
</body>
</html>"""


def _read_auth_file() -> dict:
    if not AUTH_FILE.exists():
        return {}

    try:
        return json.loads(AUTH_FILE.read_text())
    except json.JSONDecodeError:
        return {}


def _write_auth_file(data: dict) -> None:
    AUTH_FILE.parent.mkdir(parents=True, exist_ok=True)
    AUTH_FILE.write_text(json.dumps(data))


def get_stored_token() -> str | None:
    """Load the stored session token from disk."""
    token = _read_auth_file().get("token")
    return token if isinstance(token, str) and token else None


def store_token(token: str) -> None:
    """Store a session token to disk."""
    _write_auth_file({"token": token})


def get_stored_cookies() -> dict[str, str] | None:
    """Load stored session cookies from disk."""
    return _read_auth_file().get("cookies")


def store_cookies(cookies: dict[str, str]) -> None:
    """Store session cookies to disk."""
    _write_auth_file({"cookies": cookies})


def clear_stored_auth() -> None:
    """Remove any stored session token or cookies."""
    if AUTH_FILE.exists():
        AUTH_FILE.unlink()


class _CallbackResult:
    """Outcome of the browser login callback."""

    def __init__(self) -> None:
        self.code: str | None = None
        self.error: str | None = None
        self.received = False


class _CallbackHandler(BaseHTTPRequestHandler):
    """Receives the browser redirect that completes the login flow."""

    expected_state: str = ""
    result: _CallbackResult

    def do_GET(self) -> None:  # noqa: N802 (http.server API)
        parsed = urlparse(self.path)
        if parsed.path != "/callback":
            self.send_error(404)
            return

        params = parse_qs(parsed.query)
        state = params.get("state", [""])[0]
        if state != self.expected_state:
            self._respond(400, "Login failed", "Invalid state parameter. Please retry from your terminal.")
            return

        error = params.get("error", [""])[0]
        if error:
            self.result.error = error
            self.result.received = True
            self._respond(200, "Access denied", "You can close this tab and return to your terminal.")
            return

        self.result.code = params.get("code", [""])[0] or None
        self.result.received = True
        title = "Login successful" if self.result.code else "Login failed"
        self._respond(200, title, "You can close this tab and return to your terminal.")

    def _respond(self, status: int, title: str, message: str) -> None:
        body = CALLBACK_SUCCESS_PAGE.replace("{title}", title).replace("{message}", message).encode()
        self.send_response(status)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, format: str, *args) -> None:
        pass


def browser_login(backend_url: str, timeout: float = BROWSER_LOGIN_TIMEOUT_SECONDS) -> str | None:
    """Log in by approving the CLI from the web app.

    Opens the browser on the app's CLI authorization page, waits for the
    redirect back to a localhost callback, and exchanges the one-time code
    for a session token. Returns the token on success, None otherwise.
    """
    state = secrets.token_urlsafe(32)

    handler = type("BoundCallbackHandler", (_CallbackHandler,), {"expected_state": state, "result": _CallbackResult()})
    server = HTTPServer(("127.0.0.1", 0), handler)

    try:
        port = server.server_address[1]
        query = urlencode({"port": port, "state": state})
        login_url = f"{backend_url.rstrip('/')}/cli-login?{query}"

        if not webbrowser.open(login_url):
            UI.warn("Could not open a browser on this machine.")
            return None

        UI.print("[dim]Waiting for login in your browser...[/dim]")
        UI.print(f"[dim]If it did not open, visit: {login_url}[/dim]")

        result = handler.result
        deadline = time.monotonic() + timeout
        while not result.received:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                UI.error("Login timed out. Please try again.")
                return None
            server.timeout = remaining
            server.handle_request()
    finally:
        server.server_close()

    if result.error or not result.code:
        UI.error("Login was denied in the browser.")
        return None

    return _exchange_code_for_token(backend_url, result.code)


def _exchange_code_for_token(backend_url: str, code: str) -> str | None:
    try:
        response = requests.post(f"{backend_url}/api/cli-auth/token", json={"code": code})
    except requests.RequestException as e:
        UI.error(f"Connection error: {e}")
        return None

    if response.status_code != 200:
        UI.error("Could not complete login: invalid or expired authorization code.")
        return None

    token = response.json().get("token")
    if not token:
        UI.error("Login succeeded but no session token was received.")
        return None

    store_token(token)
    UI.success("Logged in successfully!")
    return token


def login(backend_url: str, email: str, password: str) -> dict[str, str] | None:
    """Authenticate with email and password (non-interactive).

    Returns session cookies on success, None on failure.
    """
    UI.print("[dim]Authenticating...[/dim]")

    try:
        response = requests.post(
            f"{backend_url}/api/auth/sign-in/email",
            json={
                "email": email,
                "password": password,
            },
        )

        if response.status_code == 200:
            cookies = dict(response.cookies)
            if cookies:
                store_cookies(cookies)
                UI.success("Logged in successfully!")
                return cookies
            else:
                UI.error("Login succeeded but no session cookie received.")
                return None
        else:
            error_msg = "Invalid credentials"
            try:
                error_data = response.json()
                if "message" in error_data:
                    error_msg = error_data["message"]
            except Exception:
                pass
            UI.error(f"Login failed: {error_msg}")
            return None

    except requests.RequestException as e:
        UI.error(f"Connection error: {e}")
        return None


def prompt_password_login(backend_url: str) -> dict[str, str] | None:
    """Prompt user for credentials and authenticate.

    Returns session cookies on success, None on failure.
    """
    email = ask_text("Email:", required_field=True)
    password = ask_text("Password:", password=True, required_field=True)

    if not email or not password:
        return None

    return login(backend_url, email, password)


def interactive_login(backend_url: str) -> bool:
    """Log in via the browser, falling back to an email/password prompt.

    Stores the resulting credentials on success and returns whether login
    succeeded.
    """
    UI.info("\n🔐 Authentication required\n")

    if browser_login(backend_url):
        return True

    UI.print("[dim]Falling back to email and password login.[/dim]")
    return prompt_password_login(backend_url) is not None


_interactive_login_lock = threading.Lock()


def apply_stored_auth(session: requests.Session) -> bool:
    """Attach stored credentials to the session. Returns whether any were found."""
    token = get_stored_token()
    if token:
        session.headers["Authorization"] = f"Bearer {token}"
        return True

    cookies = get_stored_cookies()
    if cookies:
        session.cookies.update(cookies)
        return True

    return False


def get_auth_session(
    backend_url: str,
    prompt_if_missing: bool = True,
    email: str | None = None,
    password: str | None = None,
) -> requests.Session:
    """Get a requests session with authentication credentials.

    When email and password are provided, authenticates non-interactively.
    Otherwise falls back to stored credentials or a browser login.
    """
    session = requests.Session()

    if email and password:
        cookies = login(backend_url, email, password)
        if cookies:
            session.cookies.update(cookies)
        return session

    if apply_stored_auth(session):
        return session

    if prompt_if_missing:
        with _interactive_login_lock:
            if not apply_stored_auth(session) and interactive_login(backend_url):
                apply_stored_auth(session)

    return session
