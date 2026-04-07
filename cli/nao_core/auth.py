"""Authentication utilities for nao CLI."""

import json
from pathlib import Path

import requests

from nao_core.ui import UI, ask_text

# Store credentials in user's home directory
AUTH_FILE = Path.home() / ".nao" / "auth.json"


def get_stored_cookies() -> dict[str, str] | None:
    """Load stored session cookies from disk."""
    if not AUTH_FILE.exists():
        return None

    try:
        data = json.loads(AUTH_FILE.read_text())
        return data.get("cookies")
    except (json.JSONDecodeError, KeyError):
        return None


def store_cookies(cookies: dict[str, str]) -> None:
    """Store session cookies to disk."""
    AUTH_FILE.parent.mkdir(parents=True, exist_ok=True)
    AUTH_FILE.write_text(json.dumps({"cookies": cookies}))


def clear_stored_cookies() -> None:
    """Remove stored session cookies."""
    if AUTH_FILE.exists():
        AUTH_FILE.unlink()


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


def prompt_login(backend_url: str) -> dict[str, str] | None:
    """Prompt user for credentials and authenticate.

    Returns session cookies on success, None on failure.
    """
    UI.info("\n🔐 Authentication required\n")

    email = ask_text("Email:", required_field=True)
    password = ask_text("Password:", password=True, required_field=True)

    if not email or not password:
        return None

    return login(backend_url, email, password)


def get_auth_session(
    backend_url: str,
    prompt_if_missing: bool = True,
    email: str | None = None,
    password: str | None = None,
) -> requests.Session:
    """Get a requests session with authentication cookies.

    When email and password are provided, authenticates non-interactively.
    Otherwise falls back to stored cookies or interactive prompt.
    """
    session = requests.Session()

    if email and password:
        cookies = login(backend_url, email, password)
        if cookies:
            session.cookies.update(cookies)
        return session

    cookies = get_stored_cookies()

    if cookies:
        session.cookies.update(cookies)
    elif prompt_if_missing:
        cookies = prompt_login(backend_url)
        if cookies:
            session.cookies.update(cookies)

    return session
