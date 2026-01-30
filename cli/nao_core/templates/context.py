"""Context object for Jinja templates in the nao context folder.

This module provides the `nao` object that is exposed to user Jinja templates,
allowing them to access data from various providers like Notion, databases, etc.

Example template usage:
    {{ nao.notion.page('https://notion.so/...').content }}
    {{ nao.notion.page('abc123').title }}
"""

from __future__ import annotations

from dataclasses import dataclass
from functools import cached_property
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from nao_core.config.base import NaoConfig


@dataclass
class NotionPage:
    """Represents a Notion page with lazy-loaded content."""

    page_url_or_id: str
    api_key: str
    _data: dict[str, Any] | None = None

    def _load(self) -> dict[str, Any]:
        """Lazily load page data from Notion API."""
        if self._data is None:
            from notion2md.exporter.block import StringExporter
            from notion_client import Client

            from nao_core.commands.sync.providers.notion.provider import (
                extract_page_id,
                get_page_title,
                strip_images,
            )

            page_id = extract_page_id(self.page_url_or_id)
            client = Client(auth=self.api_key)
            title = get_page_title(client, page_id)

            # Export to markdown
            md_exporter = StringExporter(block_id=page_id, token=self.api_key)
            markdown = md_exporter.export()
            markdown = strip_images(markdown)

            self._data = {
                "id": page_id,
                "title": title,
                "content": markdown,
                "url": f"https://notion.so/{page_id}",
            }
        return self._data

    @property
    def id(self) -> str:
        """The Notion page ID."""
        return self._load()["id"]

    @property
    def title(self) -> str:
        """The page title."""
        return self._load()["title"]

    @property
    def content(self) -> str:
        """The page content as markdown (without frontmatter)."""
        return self._load()["content"]

    @property
    def url(self) -> str:
        """The Notion page URL."""
        return self._load()["url"]

    def __str__(self) -> str:
        """Return the content when used directly in a template."""
        return self.content


class NotionProvider:
    """Provider interface for accessing Notion data in templates."""

    def __init__(self, config: NaoConfig):
        self._config = config
        self._page_cache: dict[str, NotionPage] = {}

    def _get_api_key_for_page(self, page_url_or_id: str) -> str:
        """Find the API key that can access a given page.

        First checks if the page is in any configured Notion config's pages list,
        otherwise uses the first available API key.
        """
        from nao_core.commands.sync.providers.notion.provider import extract_page_id

        try:
            page_id = extract_page_id(page_url_or_id)
        except ValueError:
            page_id = page_url_or_id

        # Check if page is in any config
        if self._config.notion is None or self._config.notion.pages is None:
            raise ValueError("No Notion configuration found")

        for configured_page in self._config.notion.pages:
            try:
                if extract_page_id(configured_page) == page_id:
                    return self._config.notion.api_key
            except ValueError:
                continue

        # Fallback to the configured API key (page not in explicit list, but config exists)
        return self._config.notion.api_key

    def page(self, page_url_or_id: str) -> NotionPage:
        """Get a Notion page by URL or ID.

        Args:
            page_url_or_id: Either a full Notion URL or a 32-character page ID.

        Returns:
            NotionPage object with lazy-loaded content.

        Example:
            {{ nao.notion.page('https://notion.so/My-Page-abc123').content }}
            {{ nao.notion.page('abc123def456...').title }}
        """
        if page_url_or_id not in self._page_cache:
            api_key = self._get_api_key_for_page(page_url_or_id)
            self._page_cache[page_url_or_id] = NotionPage(
                page_url_or_id=page_url_or_id,
                api_key=api_key,
            )
        return self._page_cache[page_url_or_id]


class NaoContext:
    """The main context object exposed as `nao` in user templates.

    This object provides access to data from various providers like Notion,
    databases, and repositories. Data is lazy-loaded to avoid unnecessary
    API calls.

    Example template usage:
        {{ nao.notion.page('url').content }}
        {{ nao.config.project_name }}
    """

    def __init__(self, config: NaoConfig):
        self._config = config

    @cached_property
    def notion(self) -> NotionProvider:
        """Access Notion pages and databases.

        Example:
            {{ nao.notion.page('https://notion.so/...').content }}
        """
        return NotionProvider(self._config)

    @property
    def config(self) -> NaoConfig:
        """Access the nao configuration.

        Example:
            {{ nao.config.project_name }}
        """
        return self._config

    # Future providers can be added here:
    # @cached_property
    # def database(self) -> DatabaseProvider:
    #     """Access database tables and schemas."""
    #     return DatabaseProvider(self._config)
    #
    # @cached_property
    # def repo(self) -> RepoProvider:
    #     """Access git repository files."""
    #     return RepoProvider(self._config)


def create_nao_context(config: NaoConfig) -> NaoContext:
    """Create a NaoContext for template rendering.

    Args:
        config: The nao configuration.

    Returns:
        A NaoContext instance to be used as `nao` in templates.
    """
    return NaoContext(config)
