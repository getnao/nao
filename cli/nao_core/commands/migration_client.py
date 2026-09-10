import os
from typing import Any

import requests

from nao_core.auth import get_auth_session, reauthenticate

BACKEND_URL = os.getenv("BACKEND_URL", "http://localhost:5005")


class DashboardMigrationClientError(RuntimeError):
    pass


class DashboardMigrationClient:
    def __init__(
        self,
        backend_url: str = BACKEND_URL,
        email: str | None = None,
        password: str | None = None,
    ):
        self.backend_url = backend_url.rstrip("/")
        self.email = email
        self.password = password
        self._session: requests.Session | None = None

    def request(
        self,
        method: str,
        path: str,
        *,
        params: dict[str, Any] | None = None,
        body: dict[str, Any] | None = None,
        retry_auth: bool = True,
    ) -> dict[str, Any]:
        try:
            response = self._get_session().request(
                method,
                f"{self.backend_url}/api/dashboard-migration{path}",
                params={key: value for key, value in (params or {}).items() if value is not None},
                json=body,
            )
        except requests.RequestException as error:
            raise DashboardMigrationClientError(f"Could not reach nao backend: {error}") from error

        if response.status_code == 401:
            if retry_auth and reauthenticate(self.backend_url, self.email, self.password):
                self._session = get_auth_session(self.backend_url, prompt_if_missing=False)
                return self.request(method, path, params=params, body=body, retry_auth=False)
            raise DashboardMigrationClientError("Unauthorized. Please check your credentials.")

        if not response.ok:
            try:
                message = response.json().get("error", response.text)
            except (ValueError, AttributeError):
                message = response.text
            raise DashboardMigrationClientError(f"Request failed ({response.status_code}): {message}")

        try:
            data = response.json()
        except ValueError as error:
            raise DashboardMigrationClientError("Nao backend returned invalid JSON.") from error
        if not isinstance(data, dict):
            raise DashboardMigrationClientError("Nao backend returned an unexpected response.")
        return data

    def _get_session(self) -> requests.Session:
        if self._session is None:
            self._session = get_auth_session(self.backend_url, email=self.email, password=self.password)
        return self._session
