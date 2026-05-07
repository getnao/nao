"""Context object for Jinja templates in the nao context folder.

This module provides the `nao` object that is exposed to user Jinja templates,
allowing them to access data from various providers like Notion, databases, etc.

Example template usage:
    {{ nao.notion.page('https://notion.so/...').content }}
    {{ nao.notion.page('abc123').title }}
    {{ nao.file.yaml('metadata.yaml').description }}
    {{ nao.file.text('README.md') }}
"""

from __future__ import annotations

import csv
import io
import json
from collections.abc import Callable
from dataclasses import dataclass
from functools import cached_property
from pathlib import Path
from typing import TYPE_CHECKING, Any

import yaml

if TYPE_CHECKING:
    from jinja2 import Environment

    from nao_core.config.base import NaoConfig

MAX_FILE_SIZE = 10 * 1024 * 1024  # 10MB


class FileProvider:
    """Provider for reading local project files in templates.

    All paths are relative to the project root. Absolute paths and
    path traversal (e.g. `../../etc/passwd`) are rejected.

    Example:
        {{ nao.file.yaml('config/metadata.yaml').description }}
        {{ nao.file.text('docs/intro.md') }}
        {{ nao.file.glob('schemas/*.yaml') }}
    """

    def __init__(self, project_path: Path):
        self._project_path = project_path
        self._resolved_root = project_path.resolve()
        self._cache: dict[str, Any] = {}

    def _validate_path(self, path: str) -> Path:
        """Validate and resolve a relative path against the project root."""
        p = Path(path)
        if p.is_absolute():
            raise ValueError(f"Absolute paths are not allowed: '{path}'. Use a relative path from the project root.")

        resolved = (self._project_path / p).resolve()
        if not resolved.is_relative_to(self._resolved_root):
            raise ValueError(f"Path traversal is not allowed: '{path}'. Path must stay within the project directory.")

        return resolved

    def _read_file(self, path: str) -> str:
        """Read a file with size and permission checks, using cache."""
        cache_key = f"text:{path}"
        if cache_key in self._cache:
            return self._cache[cache_key]

        resolved = self._validate_path(path)

        if not resolved.exists():
            suggestion = self._suggest_similar(path)
            msg = f"File not found: '{path}'"
            if suggestion:
                msg += f". Did you mean: {suggestion}?"
            raise FileNotFoundError(msg)

        if resolved.is_dir():
            raise ValueError(f"'{path}' is a directory, not a file")

        size = resolved.stat().st_size
        if size > MAX_FILE_SIZE:
            raise ValueError(f"File exceeds 10MB limit: '{path}' ({size / 1024 / 1024:.1f}MB)")

        try:
            content = resolved.read_text(encoding="utf-8")
        except PermissionError:
            raise PermissionError(f"Permission denied: '{path}'") from None
        except UnicodeDecodeError:
            raise ValueError(f"Cannot read '{path}': file is not valid UTF-8 text") from None

        self._cache[cache_key] = content
        return content

    def _suggest_similar(self, path: str) -> str | None:
        """Find similar files to suggest on FileNotFoundError."""
        target = Path(path)
        parent = self._project_path / target.parent
        if not parent.is_dir():
            return None

        suffix = target.suffix or ""
        candidates = [
            str(p.relative_to(self._project_path))
            for p in parent.iterdir()
            if p.is_file() and (not suffix or p.suffix == suffix)
        ]
        if not candidates:
            return None

        return ", ".join(sorted(candidates)[:3])

    def _cached_parse(self, namespace: str, path: str, parser: Callable[[str], Any]) -> Any:
        """Read a file and apply a parser, caching the result."""
        cache_key = f"{namespace}:{path}"
        if cache_key in self._cache:
            return self._cache[cache_key]

        result = parser(self._read_file(path))
        self._cache[cache_key] = result
        return result

    def yaml(self, path: str) -> Any:
        """Read and parse a YAML file.

        Returns a dict (or list) from the YAML content.
        Empty YAML files return an empty dict.
        """

        def _parse(content: str) -> Any:
            try:
                result = yaml.safe_load(content)
            except yaml.YAMLError as e:
                raise ValueError(f"Failed to parse YAML in '{path}': {e}") from e
            return result if result is not None else {}

        return self._cached_parse("yaml", path, _parse)

    def json(self, path: str) -> Any:
        """Read and parse a JSON file."""

        def _parse(content: str) -> Any:
            try:
                return json.loads(content)
            except json.JSONDecodeError as e:
                raise ValueError(f"Failed to parse JSON in '{path}': {e}") from e

        return self._cached_parse("json", path, _parse)

    def csv(self, path: str) -> list[dict[str, str]]:
        """Read a CSV file as a list of dicts (one per row)."""

        def _parse(content: str) -> list[dict[str, str]]:
            try:
                return list(csv.DictReader(io.StringIO(content)))
            except csv.Error as e:
                raise ValueError(f"Failed to parse CSV in '{path}': {e}") from e

        return self._cached_parse("csv", path, _parse)

    def text(self, path: str) -> str:
        """Read a file as a UTF-8 string."""
        return self._read_file(path)

    def frontmatter(self, path: str) -> dict[str, Any]:
        """Parse YAML frontmatter from a markdown file.

        Returns {'meta': dict, 'content': str}.
        """

        def _parse(content: str) -> dict[str, Any]:
            if not content.startswith("---"):
                return {"meta": {}, "content": content}
            parts = content.split("---", 2)
            if len(parts) < 3:
                return {"meta": {}, "content": content}
            try:
                meta = yaml.safe_load(parts[1]) or {}
            except yaml.YAMLError as e:
                raise ValueError(f"Failed to parse frontmatter in '{path}': {e}") from e
            return {"meta": meta, "content": parts[2].strip()}

        return self._cached_parse("frontmatter", path, _parse)

    def glob(self, pattern: str) -> list[str]:
        """Return matching file paths relative to the project root."""
        cache_key = f"glob:{pattern}"
        if cache_key in self._cache:
            return self._cache[cache_key]

        if ".." in pattern:
            raise ValueError(f"Path traversal is not allowed in glob pattern: '{pattern}'")

        root = self._resolved_root
        matches = sorted(
            str(p.relative_to(root)) for p in root.glob(pattern) if p.is_file() and p.resolve().is_relative_to(root)
        )
        self._cache[cache_key] = matches
        return matches

    def exists(self, path: str) -> bool:
        """Check if a file exists within the project root."""
        try:
            resolved = self._validate_path(path)
            return resolved.exists()
        except ValueError:
            return False

    def register_filters(self, env: Environment) -> None:
        """Register read_yaml and read_text as Jinja filters on the given environment."""
        env.filters["read_yaml"] = self.yaml
        env.filters["read_text"] = self.text


@dataclass
class NotionPage:
    """Represents a Notion page with lazy-loaded content."""

    page_url_or_id: str
    api_key: str
    _data: dict[str, Any] | None = None

    def _load(self) -> dict[str, Any]:
        """Lazily load page data from Notion API."""
        if self._data is None:
            from nao_core.deps import require_dependency

            require_dependency("notion_client", "notion", "for Notion integration")
            require_dependency("notion2md", "notion", "for Notion integration")

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

    def __init__(self, config: NaoConfig, project_path: Path | None = None):
        self._config = config
        self._project_path = project_path

    @cached_property
    def file(self) -> FileProvider:
        """Access local project files.

        Example:
            {{ nao.file.yaml('metadata.yaml') }}
            {{ nao.file.text('README.md') }}
        """
        if self._project_path is None:
            raise RuntimeError(
                "File reading requires a project path. "
                "This context was created without a project_path — "
                "ensure nao sync is run from a valid nao project directory."
            )
        return FileProvider(self._project_path)

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


def create_nao_context(config: NaoConfig, project_path: Path | None = None) -> NaoContext:
    """Create a NaoContext for template rendering.

    Args:
        config: The nao configuration.
        project_path: Path to the nao project root (enables file reading).

    Returns:
        A NaoContext instance to be used as `nao` in templates.
    """
    return NaoContext(config, project_path=project_path)
