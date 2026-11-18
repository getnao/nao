from typing import Any

import httpx

HTTP_TIMEOUT = 30
HTTP_RETRIES = 2
PAGE_SIZE = 100


class MetabaseError(RuntimeError):
    pass


class MetabaseClient:
    def __init__(self, base_url: str, api_key: str):
        self._base_url = base_url.rstrip("/")
        self._client = httpx.Client(
            headers={"x-api-key": api_key},
            timeout=HTTP_TIMEOUT,
            transport=httpx.HTTPTransport(retries=HTTP_RETRIES),
        )

    def __enter__(self) -> "MetabaseClient":
        return self

    def __exit__(self, *_: object) -> None:
        self._client.close()

    def fetch_dashboard(self, dashboard_id: int) -> dict[str, Any]:
        return self._fetch_object(f"/api/dashboard/{dashboard_id}", "dashboard")

    def fetch_question(self, question_id: int) -> dict[str, Any]:
        return self._fetch_object(f"/api/card/{question_id}", "question")

    def fetch_database(self, database_id: int) -> dict[str, Any]:
        return self._fetch_object(f"/api/database/{database_id}", "database")

    def _fetch_object(self, path: str, resource: str) -> dict[str, Any]:
        data = self._request_json(
            "GET",
            path,
            status_error=f"Metabase {resource} request failed",
            request_error="Could not reach Metabase",
            invalid_json_error="Metabase returned invalid JSON.",
        )
        if not isinstance(data, dict):
            raise MetabaseError(f"Metabase returned an unexpected {resource} response.")
        return data

    def fetch_collection_items(self, collection_id: int) -> list[dict[str, Any]]:
        items: list[dict[str, Any]] = []
        offset = 0
        while True:
            page = self._request_json(
                "GET",
                f"/api/collection/{collection_id}/items",
                status_error="Metabase collection request failed",
                request_error="Could not reach Metabase",
                invalid_json_error="Metabase returned invalid JSON.",
                params={"limit": PAGE_SIZE, "offset": offset},
            )
            if not isinstance(page, dict) or not isinstance(page.get("data"), list):
                raise MetabaseError("Metabase returned an unexpected collection response.")
            total = page.get("total")
            if not isinstance(total, int) or isinstance(total, bool) or total < 0:
                raise MetabaseError("Metabase returned collection pagination without a valid total.")

            page_items = page["data"]
            if not all(isinstance(item, dict) for item in page_items):
                raise MetabaseError("Metabase returned an unexpected collection item.")
            items.extend(page_items)
            offset += len(page["data"])
            if not page["data"] and offset < total:
                raise MetabaseError("Metabase collection pagination ended before reaching the reported total.")
            if offset >= total:
                return items

    def compile_question(
        self,
        question_id: int,
        dashboard_id: int | None,
        parameters: list[dict[str, Any]] | None = None,
    ) -> Any:
        body: dict[str, Any] = {"parameters": parameters or []}
        if dashboard_id is not None:
            body["dashboard_id"] = dashboard_id
        return self._request_json(
            "POST",
            f"/api/card/{question_id}/query",
            status_error="Question compilation failed",
            request_error="Could not compile Metabase question",
            invalid_json_error="Metabase returned invalid JSON while compiling the question.",
            json=body,
        )

    def _request_json(
        self,
        method: str,
        path: str,
        *,
        status_error: str,
        request_error: str,
        invalid_json_error: str,
        **kwargs: Any,
    ) -> Any:
        try:
            response = self._client.request(method, f"{self._base_url}{path}", **kwargs)
            response.raise_for_status()
        except httpx.HTTPStatusError as error:
            detail = error.response.text[:300]
            raise MetabaseError(f"{status_error} ({error.response.status_code}): {detail}") from error
        except httpx.RequestError as error:
            raise MetabaseError(f"{request_error}: {error}") from error

        try:
            return response.json()
        except ValueError as error:
            raise MetabaseError(invalid_json_error) from error
