from unittest.mock import patch

import httpx
import pytest

from nao_core.commands.imports.tableau.client import TableauClient, TableauConfig


def test_config_allows_empty_default_site(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("TABLEAU_SERVER", "https://tableau.example.com")
    monkeypatch.delenv("TABLEAU_SITE_NAME", raising=False)
    monkeypatch.setenv("TABLEAU_PAT_NAME", "name")
    monkeypatch.setenv("TABLEAU_PAT_VALUE", "value")

    assert TableauConfig.from_environment().site_name == ""


def test_list_views_reads_every_page() -> None:
    requested_pages: list[int] = []

    def respond(request: httpx.Request) -> httpx.Response:
        page_number = int(request.url.params["pageNumber"])
        requested_pages.append(page_number)
        return httpx.Response(
            200,
            content=f"""
                <tsResponse>
                  <pagination pageNumber="{page_number}" pageSize="1" totalAvailable="2" />
                  <views>
                    <view id="view-{page_number}" name="View {page_number}" />
                  </views>
                </tsResponse>
            """,
            request=request,
        )

    client = TableauClient(
        TableauConfig(
            server="https://tableau.example.com",
            site_name="site",
            pat_name="name",
            pat_value="value",
            api_version="3.21",
        )
    )
    client._client.close()
    client._client = httpx.Client(
        base_url="https://tableau.example.com",
        transport=httpx.MockTransport(respond),
    )
    client._token = "token"
    client._site_id = "site-id"

    try:
        assert client.list_views("workbook-id") == [
            {"id": "view-1", "name": "View 1", "content_url": ""},
            {"id": "view-2", "name": "View 2", "content_url": ""},
        ]
        assert requested_pages == [1, 2]
    finally:
        client._client.close()


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
