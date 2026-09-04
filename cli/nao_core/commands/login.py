import os
from typing import Annotated

import requests
from cyclopts import Parameter

from nao_core import auth
from nao_core.tracking import track_command
from nao_core.ui import UI

BACKEND_URL = os.getenv("BACKEND_URL", "http://localhost:5005")


@track_command("login")
def login(
    backend_url: Annotated[
        str | None,
        Parameter(
            name=["--backend-url"],
            help="URL of the nao server to log in to. Falls back to BACKEND_URL env var.",
        ),
    ] = None,
):
    """Log in to nao from your browser."""
    url = (backend_url or BACKEND_URL).rstrip("/")

    if not auth.interactive_login(url):
        raise SystemExit(1)


@track_command("logout")
def logout(
    backend_url: Annotated[
        str | None,
        Parameter(
            name=["--backend-url"],
            help="URL of the nao server to log out from. Falls back to BACKEND_URL env var.",
        ),
    ] = None,
):
    """Log out of nao and revoke the stored session."""
    url = (backend_url or BACKEND_URL).rstrip("/")

    token = auth.get_stored_token()
    if token:
        try:
            requests.post(f"{url}/api/auth/sign-out", headers={"Authorization": f"Bearer {token}"})
        except requests.RequestException:
            pass

    auth.clear_stored_auth()
    UI.success("Logged out.")
