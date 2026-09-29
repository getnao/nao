from unittest.mock import patch

import httpx
import pytest

from nao_core.commands.migrate.tableau.client import TableauClient, raise_for_tableau_status
from nao_core.config import TableauConfig


def test_config_allows_empty_default_site() -> None:
    config = TableauConfig(
        server="https://tableau.example.com",
        pat_name="name",
        pat_value="value",
    )

    assert config.site_name == ""


def test_list_views_reads_every_page() -> None:
    requested_pages: list[int] = []

    def respond(request: httpx.Request) -> httpx.Response:
        if request.url.path.endswith("/auth/signin"):
            assert request.headers["Accept"] == "application/json"
            assert request.headers["Content-Type"] == "application/json"
            return httpx.Response(
                200,
                json={"credentials": {"token": "token", "site": {"id": "site-id"}}},
                request=request,
            )
        if request.url.path.endswith("/auth/signout"):
            return httpx.Response(204, request=request)

        assert request.headers["X-Tableau-Auth"] == "token"
        assert request.headers["Accept"] == "application/json"
        page_number = int(request.url.params["pageNumber"])
        requested_pages.append(page_number)
        return httpx.Response(
            200,
            json={
                "pagination": {"pageNumber": page_number, "pageSize": 1, "totalAvailable": 2},
                "views": {"view": [{"id": f"view-{page_number}", "name": f"View {page_number}"}]},
            },
            request=request,
        )

    client = TableauClient(
        TableauConfig(
            server="https://tableau.example.com",
            site_name="site",
            pat_name="name",
            pat_value="value",
            api_version="3.21",
        ),
        transport=httpx.MockTransport(respond),
    )

    with client:
        assert client.list_views("workbook-id") == [
            {"id": "view-1", "name": "View 1", "content_url": ""},
            {"id": "view-2", "name": "View 2", "content_url": ""},
        ]

    assert requested_pages == [1, 2]


def test_list_workbooks_reads_json() -> None:
    def respond(request: httpx.Request) -> httpx.Response:
        if request.url.path.endswith("/auth/signin"):
            return httpx.Response(
                200,
                json={"credentials": {"token": "token", "site": {"id": "site-id"}}},
                request=request,
            )
        if request.url.path.endswith("/auth/signout"):
            return httpx.Response(204, request=request)
        return httpx.Response(
            200,
            json={
                "pagination": {"pageNumber": 1, "pageSize": 1000, "totalAvailable": 1},
                "workbooks": {
                    "workbook": [
                        {
                            "id": "workbook-id",
                            "name": "Sales",
                            "contentUrl": "sales",
                            "project": {"id": "project-id", "name": "Analytics"},
                        }
                    ]
                },
            },
            request=request,
        )

    client = TableauClient(
        TableauConfig(
            server="https://tableau.example.com",
            site_name="site",
            pat_name="name",
            pat_value="value",
        ),
        transport=httpx.MockTransport(respond),
    )

    with client:
        assert client.list_workbooks() == [
            {
                "id": "workbook-id",
                "name": "Sales",
                "content_url": "sales",
                "project_id": "project-id",
                "project_name": "Analytics",
            }
        ]


def test_tableau_json_error_is_sanitized() -> None:
    response = httpx.Response(
        401,
        json={"error": {"summary": "Signin Error", "detail": "Invalid personal access token."}},
        request=httpx.Request("POST", "https://tableau.example.com/api/3.21/auth/signin"),
    )

    with pytest.raises(
        ValueError,
        match="Tableau API request failed with status 401: Signin Error: Invalid personal access token",
    ):
        raise_for_tableau_status(response)


def test_find_workbook_uses_consistent_name_normalization() -> None:
    client = TableauClient(
        TableauConfig(
            server="https://tableau.example.com",
            site_name="site",
            pat_name="name",
            pat_value="value",
            api_version="3.21",
        )
    )
    workbook = {
        "id": "workbook-id",
        "name": "Sales_Overview",
        "content_url": "sales-overview",
        "project_id": "project-id",
        "project_name": "Executive-Dashboards",
    }

    try:
        with patch.object(client, "list_workbooks", return_value=[workbook]):
            assert client.find_workbook("Sales Overview", "Executive Dashboards") == workbook
    finally:
        client._client.close()
