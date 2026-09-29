from typing import Any

import httpx

from nao_core.config import TableauConfig

from .utils import normalize


class TableauClient:
    def __init__(
        self,
        config: TableauConfig,
        timeout: float = 60.0,
        transport: httpx.BaseTransport | None = None,
    ):
        self._config = config
        self._client = httpx.Client(
            base_url=config.server,
            timeout=timeout,
            follow_redirects=True,
            transport=transport,
        )
        self._token = ""
        self._site_id = ""

    def __enter__(self) -> "TableauClient":
        self.sign_in()
        return self

    def __exit__(self, *_: object) -> None:
        try:
            self.sign_out()
        except Exception:
            pass
        finally:
            self._client.close()

    def sign_in(self) -> None:
        response = self._client.post(
            self._api_path("auth/signin"),
            json={
                "credentials": {
                    "personalAccessTokenName": self._config.pat_name,
                    "personalAccessTokenSecret": self._config.pat_value,
                    "site": {"contentUrl": self._config.site_name},
                }
            },
            headers={"Accept": "application/json"},
        )
        raise_for_tableau_status(response)
        payload = parse_json_response(response)
        credentials = payload.get("credentials")
        site = credentials.get("site") if isinstance(credentials, dict) else None
        if not isinstance(credentials, dict) or not isinstance(site, dict):
            raise ValueError("Tableau sign-in returned no credentials or site identifier.")
        self._token = credentials.get("token", "")
        self._site_id = site.get("id", "")
        if not self._token or not self._site_id:
            raise ValueError("Tableau sign-in returned incomplete authentication metadata.")

    def sign_out(self) -> None:
        if not self._token:
            return
        response = self._client.post(
            self._api_path("auth/signout"),
            headers=self._headers(),
        )
        raise_for_tableau_status(response)
        self._token = ""

    def find_workbook(
        self,
        name: str,
        project_name: str | None = None,
    ) -> dict[str, str]:
        matches = [
            workbook
            for workbook in self.list_workbooks()
            if normalize(workbook["name"]) == normalize(name)
            and (project_name is None or normalize(workbook.get("project_name", "")) == normalize(project_name))
        ]
        if not matches:
            scope = f' in project "{project_name}"' if project_name else ""
            raise ValueError(f'No Tableau workbook named "{name}" was found{scope}.')
        if len(matches) > 1:
            projects = ", ".join(sorted({workbook.get("project_name", "unknown project") for workbook in matches}))
            raise ValueError(
                f'Multiple Tableau workbooks named "{name}" were found. '
                f"Choose a project with --project. Available projects: {projects}."
            )
        return matches[0]

    def list_workbooks(self) -> list[dict[str, str]]:
        workbooks: list[dict[str, str]] = []
        page_number = 1

        while True:
            response = self._client.get(
                self._site_path("workbooks"),
                params={"pageNumber": page_number, "pageSize": 1000},
                headers={**self._headers(), "Accept": "application/json"},
            )
            raise_for_tableau_status(response)
            payload = parse_json_response(response)
            workbook_items = payload.get("workbooks", {}).get("workbook", [])
            if not isinstance(workbook_items, list):
                raise ValueError("Tableau API returned an invalid workbook list.")
            for workbook in workbook_items:
                if not isinstance(workbook, dict):
                    continue
                project = workbook.get("project", {})
                workbooks.append(
                    {
                        "id": workbook.get("id", ""),
                        "name": workbook.get("name", ""),
                        "content_url": workbook.get("contentUrl", ""),
                        "project_id": project.get("id", ""),
                        "project_name": project.get("name", ""),
                    }
                )
            if not has_next_page(payload, page_number):
                return workbooks
            page_number += 1

    def list_views(self, workbook_id: str) -> list[dict[str, str]]:
        views: list[dict[str, str]] = []
        page_number = 1

        while True:
            response = self._client.get(
                self._site_path(f"workbooks/{workbook_id}/views"),
                params={"pageNumber": page_number, "pageSize": 1000},
                headers={**self._headers(), "Accept": "application/json"},
            )
            raise_for_tableau_status(response)
            payload = parse_json_response(response)
            view_items = payload.get("views", {}).get("view", [])
            if not isinstance(view_items, list):
                raise ValueError("Tableau API returned an invalid view list.")
            for view in view_items:
                if not isinstance(view, dict):
                    continue
                view_id = view.get("id")
                name = view.get("name")
                if view_id and name:
                    views.append(
                        {
                            "id": view_id,
                            "name": name,
                            "content_url": view.get("contentUrl", ""),
                        }
                    )
            if not has_next_page(payload, page_number):
                return views
            page_number += 1

    def download_workbook(
        self,
        workbook_id: str,
        include_extract: bool = False,
    ) -> bytes:
        response = self._client.get(
            self._site_path(f"workbooks/{workbook_id}/content"),
            params={"includeExtract": str(include_extract).lower()},
            headers=self._headers(),
        )
        raise_for_tableau_status(response)
        return response.content

    def download_view_data(self, view_id: str) -> bytes:
        response = self._client.get(
            self._site_path(f"views/{view_id}/data"),
            headers=self._headers(),
        )
        raise_for_tableau_status(response)
        return response.content

    def download_view_image(self, view_id: str) -> bytes:
        response = self._client.get(
            self._site_path(f"views/{view_id}/image"),
            headers=self._headers(),
        )
        raise_for_tableau_status(response)
        return response.content

    def _api_path(self, path: str) -> str:
        return f"/api/{self._config.api_version}/{path}"

    def _site_path(self, path: str) -> str:
        return self._api_path(f"sites/{self._site_id}/{path}")

    def _headers(self) -> dict[str, str]:
        if not self._token:
            raise ValueError("Tableau client is not signed in.")
        return {"X-Tableau-Auth": self._token}


def raise_for_tableau_status(response: httpx.Response) -> None:
    if response.is_success:
        return

    summary = ""
    detail = ""
    try:
        payload = response.json()
        error = payload.get("error", {})
        if isinstance(error, dict):
            summary = error.get("summary", "")
            detail = error.get("detail", "")
    except (AttributeError, ValueError):
        pass

    message = ": ".join(
        part
        for part in (
            f"Tableau API request failed with status {response.status_code}",
            summary,
            detail,
        )
        if part
    )
    raise ValueError(message)


def parse_json_response(response: httpx.Response) -> dict[str, Any]:
    try:
        payload = response.json()
    except ValueError as error:
        raise ValueError("Tableau API returned invalid JSON.") from error
    if not isinstance(payload, dict):
        raise ValueError("Tableau API returned invalid JSON.")
    return payload


def has_next_page(payload: dict[str, Any], page_number: int) -> bool:
    pagination = payload.get("pagination", {})
    if not isinstance(pagination, dict):
        return False
    total = integer_value(pagination.get("totalAvailable"))
    page_size = integer_value(pagination.get("pageSize")) or 1000
    return total is not None and page_number * page_size < total


def integer_value(value: object) -> int | None:
    try:
        return int(str(value))
    except ValueError:
        return None
