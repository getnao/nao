import os
from typing import Any

import requests

from nao_core.auth import HTTP_TIMEOUT, get_auth_session, reauthenticate

BACKEND_URL = os.getenv("BACKEND_URL", "http://localhost:5005")


class MigrationError(RuntimeError):
    pass


class MigrationClient:
    def __init__(
        self,
        backend_url: str = BACKEND_URL,
        *,
        project_id: str | None = None,
        noninteractive: bool = False,
    ):
        self.backend_url = backend_url.rstrip("/")
        self.project_id = project_id or os.getenv("NAO_PROJECT_ID")
        self.noninteractive = noninteractive
        self._email = os.getenv("NAO_USERNAME") if noninteractive else None
        self._password = os.getenv("NAO_PASSWORD") if noninteractive else None
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
                headers={"x-nao-project-id": self.project_id} if self.project_id else None,
                timeout=HTTP_TIMEOUT,
            )
        except requests.RequestException as error:
            raise MigrationError(f"Could not reach nao backend: {error}") from error

        if response.status_code == 401:
            authenticated = retry_auth and reauthenticate(
                self.backend_url,
                self._email,
                self._password,
                prompt_if_missing=not self.noninteractive,
                quiet=self.noninteractive,
                timeout=HTTP_TIMEOUT,
            )
            if authenticated:
                self._session = get_auth_session(
                    self.backend_url,
                    prompt_if_missing=False,
                    quiet=self.noninteractive,
                    timeout=HTTP_TIMEOUT,
                )
                return self.request(method, path, params=params, body=body, retry_auth=False)
            raise MigrationError("Unauthorized. Please check your credentials.")

        if not response.ok:
            try:
                message = response.json().get("error", response.text)
            except (ValueError, AttributeError):
                message = response.text
            raise MigrationError(f"Request failed ({response.status_code}): {message}")

        try:
            data = response.json()
        except ValueError as error:
            raise MigrationError("Nao backend returned invalid JSON.") from error
        if not isinstance(data, dict):
            raise MigrationError("Nao backend returned an unexpected response.")
        return data

    def _get_session(self) -> requests.Session:
        if self._session is None:
            self._session = get_auth_session(
                self.backend_url,
                prompt_if_missing=not self.noninteractive,
                email=self._email,
                password=self._password,
                quiet=self.noninteractive,
                timeout=HTTP_TIMEOUT,
            )
        return self._session
