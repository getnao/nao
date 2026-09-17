import os
from dataclasses import dataclass
from xml.etree import ElementTree

import httpx


@dataclass(frozen=True)
class TableauConfig:
    server: str
    site_name: str
    pat_name: str
    pat_value: str
    api_version: str

    @classmethod
    def from_environment(cls) -> "TableauConfig":
        return cls(
            server=required_environment("TABLEAU_SERVER").rstrip("/"),
            site_name=required_environment("TABLEAU_SITE_NAME"),
            pat_name=required_environment("TABLEAU_PAT_NAME"),
            pat_value=required_environment("TABLEAU_PAT_VALUE"),
            api_version=os.environ.get("TABLEAU_API_VERSION", "3.21"),
        )


class TableauClient:
    def __init__(self, config: TableauConfig, timeout: float = 60.0):
        self._config = config
        self._client = httpx.Client(
            base_url=config.server,
            timeout=timeout,
            follow_redirects=True,
        )
        self._token = ""
        self._site_id = ""

    def __enter__(self) -> "TableauClient":
        self.sign_in()
        return self

    def __exit__(self, *_: object) -> None:
        try:
            self.sign_out()
        finally:
            self._client.close()

    def sign_in(self) -> None:
        request = ElementTree.Element("tsRequest")
        credentials = ElementTree.SubElement(
            request,
            "credentials",
            {
                "personalAccessTokenName": self._config.pat_name,
                "personalAccessTokenSecret": self._config.pat_value,
            },
        )
        ElementTree.SubElement(
            credentials,
            "site",
            {"contentUrl": self._config.site_name},
        )
        response = self._client.post(
            self._api_path("auth/signin"),
            content=ElementTree.tostring(request, encoding="utf-8"),
            headers={"Content-Type": "application/xml", "Accept": "application/xml"},
        )
        raise_for_tableau_status(response)
        root = parse_xml_response(response)
        response_credentials = first_named(root, "credentials")
        site = first_named(root, "site")
        if response_credentials is None or site is None:
            raise ValueError("Tableau sign-in returned no credentials or site identifier.")
        self._token = response_credentials.attrib.get("token", "")
        self._site_id = site.attrib.get("id", "")
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
                headers=self._headers(),
            )
            raise_for_tableau_status(response)
            root = parse_xml_response(response)
            for workbook in elements_named(root, "workbook"):
                project = first_named(workbook, "project")
                workbooks.append(
                    {
                        "id": workbook.attrib.get("id", ""),
                        "name": workbook.attrib.get("name", ""),
                        "content_url": workbook.attrib.get("contentUrl", ""),
                        "project_id": project.attrib.get("id", "") if project is not None else "",
                        "project_name": project.attrib.get("name", "") if project is not None else "",
                    }
                )
            pagination = first_named(root, "pagination")
            total = integer_attribute(pagination, "totalAvailable")
            page_size = integer_attribute(pagination, "pageSize") or 1000
            if total is None or page_number * page_size >= total:
                return workbooks
            page_number += 1

    def list_views(self, workbook_id: str) -> list[dict[str, str]]:
        response = self._client.get(
            self._site_path(f"workbooks/{workbook_id}/views"),
            params={"pageSize": 1000},
            headers=self._headers(),
        )
        raise_for_tableau_status(response)
        root = parse_xml_response(response)
        return [
            {
                "id": view.attrib.get("id", ""),
                "name": view.attrib.get("name", ""),
                "content_url": view.attrib.get("contentUrl", ""),
            }
            for view in elements_named(root, "view")
            if view.attrib.get("id") and view.attrib.get("name")
        ]

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


def required_environment(name: str) -> str:
    value = os.environ.get(name, "").strip()
    if not value:
        raise ValueError(f"Missing required Tableau environment variable {name}.")
    return value


def raise_for_tableau_status(response: httpx.Response) -> None:
    if response.is_success:
        return

    summary = ""
    detail = ""
    try:
        root = ElementTree.fromstring(response.content)
        error = first_named(root, "error")
        summary_element = first_named(error, "summary") if error is not None else None
        detail_element = first_named(error, "detail") if error is not None else None
        summary = element_text(summary_element)
        detail = element_text(detail_element)
    except ElementTree.ParseError:
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


def parse_xml_response(response: httpx.Response) -> ElementTree.Element:
    try:
        return ElementTree.fromstring(response.content)
    except ElementTree.ParseError as error:
        raise ValueError("Tableau API returned invalid XML.") from error


def elements_named(
    root: ElementTree.Element,
    name: str,
) -> list[ElementTree.Element]:
    return [element for element in root.iter() if local_name(element) == name]


def first_named(
    root: ElementTree.Element,
    name: str,
) -> ElementTree.Element | None:
    return next(
        (element for element in root.iter() if local_name(element) == name),
        None,
    )


def local_name(element: ElementTree.Element) -> str:
    return element.tag.rsplit("}", 1)[-1].rsplit(":", 1)[-1].lower()


def element_text(element: ElementTree.Element | None) -> str:
    if element is None:
        return ""
    return " ".join(text.strip() for text in element.itertext() if text.strip())


def integer_attribute(
    element: ElementTree.Element | None,
    name: str,
) -> int | None:
    if element is None:
        return None
    value = element.attrib.get(name, "")
    try:
        return int(value)
    except ValueError:
        return None


def normalize(value: str) -> str:
    return " ".join(value.lower().split())
