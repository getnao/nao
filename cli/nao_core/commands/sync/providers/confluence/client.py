"""A thin Confluence REST client covering both Cloud and Data Center/Server.

Both flavours expose the same v1 content API under `{base_url}/rest/api`; they differ only in
how a request is authenticated. Keeping that difference in one place lets the sync provider treat
a page the same way whichever deployment it came from.
"""

from __future__ import annotations

import re
from collections.abc import Iterator
from dataclasses import dataclass, field
from typing import Any

import httpx

from nao_core.config.confluence import ConfluenceConfig

# Confluence page IDs are bare integers. URLs carry them either in the modern path form
# (/pages/123456/Title) or the legacy query form (viewpage.action?pageId=123456).
PAGE_ID_IN_PATH = re.compile(r"/pages/(\d+)")
PAGE_ID_IN_QUERY = re.compile(r"[?&]pageId=(\d+)")
BARE_PAGE_ID = re.compile(r"^\d+$")

# The body rendering that resolves macros to HTML a reader would recognise, rather than the
# raw storage XHTML whose macro placeholders convert to nothing useful. Ancestors come along so
# the sync can mirror a page's place in the tree on disk.
BODY_EXPANSION = "body.export_view,version,space,ancestors"

# A search asks only for what tells an unchanged page apart from a changed one, so the body of a
# page that already synced at this version is never fetched again.
SEARCH_EXPANSION = "version,space"

# Content is paged; a source with more items than this is read across several requests.
PAGE_SIZE = 50

# Bound every paging loop so a cursor that never advances cannot hang a worker thread.
MAX_PAGES = 1000


@dataclass
class Ancestor:
    """A parent of a page, as far up the tree as Confluence reports."""

    id: str
    title: str


@dataclass
class ConfluencePage:
    """A fetched Confluence page reduced to what the sync writes to disk."""

    id: str
    title: str
    space_key: str | None
    version: int
    html: str
    url: str
    content_type: str = "page"
    ancestors: list[Ancestor] = field(default_factory=list)


@dataclass
class PageRef:
    """A page to sync, with its version when a search already revealed it.

    A search carries the version of every item it returns, so an unchanged page can be recognised
    without fetching its body. A page named on its own carries no such hint, so its version is
    unknown until it is fetched.
    """

    id: str
    version: int | None = None


def extract_page_id(reference: str) -> str:
    """Extract a Confluence page ID from a raw ID or a URL that carries one.

    URLs that identify a page only by space and title (the `/display/SPACE/Title` form) carry no
    ID and cannot be resolved here; the page ID or an ID-bearing URL must be used instead.
    """
    reference = reference.strip()
    if BARE_PAGE_ID.match(reference):
        return reference

    for pattern in (PAGE_ID_IN_PATH, PAGE_ID_IN_QUERY):
        match = pattern.search(reference)
        if match:
            return match.group(1)

    raise ValueError(
        f"Could not extract a Confluence page ID from '{reference}'. "
        "Use the numeric page ID or a URL that contains it (e.g. .../pages/123456/Title)."
    )


class ConfluenceClient:
    """Reads pages and runs CQL searches against Confluence over its v1 REST API."""

    def __init__(self, config: ConfluenceConfig, *, timeout: float = 30.0):
        self._base = config.base_url.rstrip("/")
        self._client = httpx.Client(
            auth=self._auth(config),
            headers=self._headers(config),
            timeout=timeout,
            follow_redirects=True,
        )

    def __enter__(self) -> "ConfluenceClient":
        return self

    def __exit__(self, *_: object) -> None:
        self.close()

    def close(self) -> None:
        self._client.close()

    @staticmethod
    def _auth(config: ConfluenceConfig) -> httpx.Auth | None:
        if config.deployment == "cloud":
            return httpx.BasicAuth(config.email or "", config.api_token or "")
        if config.personal_access_token:
            return None
        return httpx.BasicAuth(config.username or "", config.password or "")

    @staticmethod
    def _headers(config: ConfluenceConfig) -> dict[str, str]:
        headers = {"Accept": "application/json"}
        if config.deployment == "server" and config.personal_access_token:
            headers["Authorization"] = f"Bearer {config.personal_access_token}"
        return headers

    def get_page(self, page_id: str) -> ConfluencePage:
        """Fetch a single page with its rendered body, version and ancestors."""
        response = self._client.get(
            f"{self._base}/rest/api/content/{page_id}",
            params={"expand": BODY_EXPANSION},
        )
        response.raise_for_status()
        return self._to_page(response.json())

    def search_refs(self, cql: str) -> Iterator[PageRef]:
        """Yield a reference and version for every item a CQL search selects.

        The body is left out so the search stays cheap: an unchanged page is recognised from its
        version alone and its body is never fetched again. The v1 search is paged by start/limit
        and reports a relative `_links.next` while more results remain.
        """
        start = 0
        for _ in range(MAX_PAGES):
            response = self._client.get(
                f"{self._base}/rest/api/content/search",
                params={"cql": cql, "start": start, "limit": PAGE_SIZE, "expand": SEARCH_EXPANSION},
            )
            response.raise_for_status()
            payload = response.json()

            results = payload.get("results", [])
            for result in results:
                version = (result.get("version") or {}).get("number", 0) or 0
                yield PageRef(id=str(result.get("id", "")), version=int(version))

            if not payload.get("_links", {}).get("next") or not results:
                return
            start += len(results)

        raise RuntimeError(
            f"Confluence search returned more than {MAX_PAGES * PAGE_SIZE} results for CQL '{cql}'. "
            "Refusing to continue with a truncated result set, which would delete already-synced "
            "pages beyond the cap. Narrow the selector (e.g. scope a label to a space) and retry."
        )

    def _to_page(self, payload: dict[str, Any]) -> ConfluencePage:
        space = payload.get("space") or {}
        version = payload.get("version") or {}
        body = (payload.get("body") or {}).get("export_view") or {}
        ancestors = [
            Ancestor(id=str(a.get("id", "")), title=a.get("title") or str(a.get("id", "")))
            for a in payload.get("ancestors") or []
        ]

        return ConfluencePage(
            id=str(payload.get("id", "")),
            title=payload.get("title") or str(payload.get("id", "")),
            space_key=space.get("key"),
            version=int(version.get("number", 0) or 0),
            html=body.get("value") or "",
            url=self._page_url(payload),
            content_type=payload.get("type") or "page",
            ancestors=ancestors,
        )

    def _page_url(self, payload: dict[str, Any]) -> str:
        webui = (payload.get("_links") or {}).get("webui")
        if webui:
            return f"{self._base}{webui}"
        return f"{self._base}/pages/viewpage.action?pageId={payload.get('id', '')}"
