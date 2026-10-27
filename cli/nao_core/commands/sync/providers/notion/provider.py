import logging
import re
from collections import deque
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from typing import Any, cast

import yaml
from rich.console import Console
from rich.markup import escape
from rich.progress import BarColumn, Progress, SpinnerColumn, TaskProgressColumn, TextColumn

from nao_core.config.base import NaoConfig
from nao_core.config.notion import NotionConfig
from nao_core.ui import UI

from ..base import SyncProvider, SyncResult
from .database import fetch_rows, get_database_as_markdown, inject_child_databases, list_children

console = Console()


class _ExpectedDatabaseProbeFilter(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        return "is a database, not a page" not in record.getMessage()


logging.getLogger("notion_client").addFilter(_ExpectedDatabaseProbeFilter())

# Notion object IDs appear both bare and as dashed UUIDs. Accepting only the bare form would
# make a dashed ?v= silently ignored, widening an export that asked for one view.
NOTION_ID = r"[0-9a-fA-F]{32}|[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}"
NOTION_ID_PATTERN = re.compile(NOTION_ID)

# View IDs appear as the `v` query parameter of a database URL
NOTION_VIEW_PARAM_PATTERN = re.compile(r"[?&]v=([^&#]*)")

# Pinned so behaviour does not depend on the notion-client version resolved at install time.
# The Views API requires 2025-09-03 or later.
NOTION_API_VERSION = "2025-09-03"

# Notion titles run far longer than a filename usefully can
MAX_SLUG_LENGTH = 80


def cleanup_stale_pages(synced_files: set[str], output_path: Path, verbose: bool = False) -> int:
    """Remove markdown files that were not synced.

    Args:
        synced_files: Set of relative file paths that were synced in this run.
        output_path: Path where synced markdown files are stored.
        verbose: Whether to print cleanup messages.

    Returns:
        Number of stale files removed.
    """
    if not output_path.exists():
        return 0

    removed_count = 0
    for file_path in output_path.rglob("*.md"):
        relative_path = file_path.relative_to(output_path).as_posix()
        if relative_path not in synced_files:
            file_path.unlink()
            removed_count += 1
            if verbose:
                UI.print(f"  [dim red]removing stale page:[/dim red] {relative_path}")

    directories = sorted((path for path in output_path.rglob("*") if path.is_dir()), key=lambda path: len(path.parts))
    for directory in reversed(directories):
        try:
            directory.rmdir()
        except OSError:
            continue

    return removed_count


# Pattern to match markdown images: ![alt](url)
IMAGE_PATTERN = re.compile(r"!\[[^\]]*\]\([^)]+\)\n?")


def strip_images(markdown: str) -> str:
    """Replace markdown image references with a placeholder."""
    return IMAGE_PATTERN.sub("[image]\n", markdown)


def extract_notion_id(url: str) -> str:
    """Extract a Notion object ID (page or database) from a URL.

    Handles URLs like:
    - https://www.notion.so/naolabs/Conversational-analytics-2bfc7a70bc0680978900d1e85ece83a0
    - https://www.notion.so/2bfc7a70bc0680978900d1e85ece83a0
    - 2bfc7a70bc0680978900d1e85ece83a0 (raw ID)
    - 2bfc7a70-bc06-8097-8900-d1e85ece83a0 (dashed UUID)
    """
    match = NOTION_ID_PATTERN.search(url)
    if match:
        return normalise_id(match.group(0))
    raise ValueError(f"Could not extract Notion ID from: {url}")


def extract_view_id(url: str) -> str | None:
    """Extract the view ID from a database URL, if it targets a specific view.

    A `v` parameter that cannot be read raises rather than returning None: treating it as
    "no view requested" would export every row of a database whose URL asked for a subset.
    """
    param = NOTION_VIEW_PARAM_PATTERN.search(url)
    if not param:
        return None

    view_id = NOTION_ID_PATTERN.fullmatch(param.group(1))
    if not view_id:
        raise ValueError(f"Could not read the view ID from: {url}")

    return normalise_id(view_id.group(0))


def normalise_id(raw: str) -> str:
    """Reduce a Notion ID to the bare lowercase hex form every endpoint accepts."""
    return raw.replace("-", "").lower()


def cleanup_if_fully_synced(
    failed_pages: int,
    synced_files: set[str],
    output_path: Path,
    *,
    discovery_complete: bool = True,
) -> int:
    """Remove stale markdown only when every page synced.

    A page that failed is absent from the synced set, so cleaning up after a partial run would
    delete markdown that is still good, losing content to what is often a transient error.
    Files no longer in Notion therefore survive until every page syncs again.
    """
    if failed_pages:
        UI.print(
            f"[yellow]⚠[/yellow]  Keeping existing files: {failed_pages} page(s) failed, so stale ones were "
            "left in place and will remain until a run succeeds in full"
        )
        return 0
    if not discovery_complete:
        UI.print("[yellow]⚠[/yellow]  Keeping existing files because recursive discovery was incomplete")
        return 0

    return cleanup_stale_pages(synced_files, output_path, verbose=True)


def discover_documents(config: NotionConfig) -> tuple[list[str], dict[str, str], bool, int]:
    """Add descendants in breadth-first order and record their parent references."""
    references = list(dict.fromkeys(config.pages))
    if config.max_depth == 0:
        return references, {}, False, 0

    client = create_client(config.api_key)
    output_ids = extract_reference_ids(references)
    visited: set[tuple[str, str | None]] = set()
    parent_references: dict[str, str] = {}
    queue: deque[tuple[str, int, str | None]] = deque((reference, 0, None) for reference in references)
    discovered = 0
    truncated = False
    failed = 0

    while queue:
        reference, depth, parent_reference = queue.popleft()
        try:
            object_id = extract_notion_id(reference)
            traversal_key = (object_id, extract_view_id(reference) if depth == 0 else None)
        except Exception as error:  # noqa: BLE001 - one invalid root must not stop the rest
            failed += 1
            UI.print(
                f"[bold red]✗[/bold red] Failed to discover descendants of {escape(reference)}: {escape(str(error))}"
            )
            continue

        if traversal_key in visited:
            continue

        visited.add(traversal_key)
        if depth > 0:
            if discovered >= config.max_pages:
                return references, parent_references, True, failed
            discovered += 1

        if depth > 0 and object_id not in output_ids:
            if parent_reference is None:
                raise ValueError(f"Discovered Notion page {object_id} without a parent")
            references.append(reference)
            output_ids.add(object_id)
            parent_references[object_id] = parent_reference

        if depth >= config.max_depth:
            continue

        try:
            page = retrieve_page(client, object_id)
            if page is None:
                if depth > 0:
                    continue
                database = cast(dict[str, Any], client.databases.retrieve(database_id=object_id))
                database_rows = fetch_rows(client, database, extract_view_id(reference))
                truncated = truncated or not database_rows.complete or database_rows.unmatched > 0
                child_ids = []
                remaining_pages = max(config.max_pages - discovered, 0)
                for row in database_rows.rows:
                    if len(child_ids) >= remaining_pages:
                        truncated = True
                        break
                    if not is_empty_database_row(client, row):
                        child_ids.append(cast(str, row["id"]))
            else:
                child_ids = find_child_page_ids(client, object_id)
        except Exception as error:  # noqa: BLE001 - one unreadable branch must not stop the rest
            failed += 1
            UI.print(
                f"[bold red]✗[/bold red] Failed to discover descendants of {escape(reference)}: {escape(str(error))}"
            )
            continue

        queue.extend((child_id, depth + 1, reference) for child_id in child_ids)

    return references, parent_references, truncated, failed


def extract_reference_ids(references: list[str]) -> set[str]:
    ids: set[str] = set()
    for reference in references:
        try:
            ids.add(extract_notion_id(reference))
        except ValueError:
            continue
    return ids


def find_child_page_ids(client: Any, block_id: str) -> list[str]:
    """Find child pages anywhere inside a page's block containers."""
    page_ids: list[str] = []

    for block in list_children(client, block_id):
        block_type = block["type"]
        if block_type == "child_page":
            page_ids.append(block["id"])
        elif block.get("has_children") and block_type not in {"child_database", "table"}:
            page_ids.extend(find_child_page_ids(client, block["id"]))

    return page_ids


def is_empty_database_row(client: Any, row: dict[str, Any]) -> bool:
    has_title = any(
        part.get("plain_text", "").strip()
        for prop in row.get("properties", {}).values()
        if prop.get("type") == "title"
        for part in prop.get("title", [])
    )
    if has_title:
        return False

    response = cast(dict[str, Any], client.blocks.children.list(row["id"], page_size=1))
    return not response.get("results")


def fetch_documents(page_urls: list[str], api_key: str, threads: int) -> tuple[list[tuple[str, str, str]], int]:
    """Fetch every configured item, returning them in configuration order with a failure count.

    Writing is deferred until every fetch has been attempted, so filenames can be assigned
    from a stable order rather than from whichever thread finished first.
    """
    documents: dict[str, tuple[str, str, str]] = {}
    failed = 0

    with Progress(
        SpinnerColumn(style="dim"),
        TextColumn("[progress.description]{task.description}"),
        BarColumn(bar_width=30, style="dim", complete_style="cyan", finished_style="green"),
        TaskProgressColumn(),
        console=console,
        transient=False,
    ) as progress:
        task = progress.add_task("Syncing pages", total=len(page_urls))

        def record(page_url: str, fetch: Callable[[], tuple[str, str]]) -> None:
            """Run one fetch, keeping a failure to a single item.

            Titles and errors come from Notion, so they are escaped: a stray closing tag in
            either would raise out of this handler and abort the whole sync.
            """
            nonlocal failed
            try:
                title, markdown = fetch()
                documents[page_url] = (page_url, title, markdown)
                progress.update(task, advance=1, description=f"Synced: {escape(title)}")
            except Exception as error:  # noqa: BLE001 - one unreadable item must not stop the rest
                failed += 1
                UI.print(f"[bold red]✗[/bold red] Failed to sync page {escape(page_url)}: {escape(str(error))}")
                progress.update(task, advance=1)

        if threads <= 1 or len(page_urls) == 1:
            for page_url in page_urls:
                record(page_url, lambda url=page_url: get_content_as_markdown(url, api_key))
        else:
            with ThreadPoolExecutor(max_workers=min(threads, len(page_urls))) as executor:
                futures = {executor.submit(get_content_as_markdown, url, api_key): url for url in page_urls}
                for future in as_completed(futures):
                    record(futures[future], future.result)

    return [documents[url] for url in page_urls if url in documents], failed


def write_documents(
    documents: list[tuple[str, str, str]],
    output_path: Path,
    parent_references: dict[str, str] | None = None,
) -> tuple[set[str], list[str], int]:
    """Write fetched documents under their parents, keeping failures to their own items.

    Notion content is written as UTF-8 rather than in the platform encoding, which would fail
    on the arrows, dashes and emoji it routinely contains. An encoding failure is not an
    OSError, so it is caught explicitly rather than escaping the whole write phase.
    """
    written: set[str] = set()
    titles: list[str] = []
    failed = 0
    document_titles = {reference: title for reference, title, _ in documents}

    for reference, title, markdown in documents:
        try:
            relative_path = document_relative_path(
                reference,
                title,
                document_titles,
                parent_references or {},
            )
            target = output_path / relative_path
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text(markdown, encoding="utf-8")
        except (OSError, UnicodeError, ValueError) as error:
            failed += 1
            UI.print(
                f"[bold red]✗[/bold red] Failed to write {escape(markdown_filename(title, reference))}: "
                f"{escape(str(error))}"
            )
            continue

        written.add(relative_path.as_posix())
        titles.append(title)

    return written, titles, failed


def document_relative_path(
    reference: str,
    title: str,
    document_titles: dict[str, str],
    parent_references: dict[str, str],
) -> Path:
    directories: list[str] = []
    try:
        parent_reference = parent_references.get(extract_notion_id(reference))
    except ValueError:
        return Path(markdown_filename(title, reference))
    visited: set[str] = set()

    while parent_reference:
        parent_id = extract_notion_id(parent_reference)
        if parent_id in visited:
            raise ValueError(f"Notion parent cycle detected at {parent_id}")
        visited.add(parent_id)

        parent_title = document_titles.get(parent_reference)
        if parent_title is None:
            raise ValueError(f"parent page {parent_id} was not fetched")
        directories.append(markdown_filename(parent_title, parent_reference).removesuffix(".md"))
        parent_reference = parent_references.get(parent_id)

    return Path(*reversed(directories), markdown_filename(title, reference))


def short_reference(reference: str) -> str:
    """A stable, filename-safe fragment identifying an item.

    The view is part of that identity. Two URLs can point at one database through different
    views, and the database id alone would name both exports the same file.
    """
    try:
        identifier = extract_notion_id(reference)[:8]
    except ValueError:
        return re.sub(r"[^\w-]", "", reference).lower()[:8] or "item"

    try:
        view_id = extract_view_id(reference)
    except ValueError:
        view_id = None

    return f"{identifier}-{view_id[:8]}" if view_id else identifier


def markdown_filename(title: str, reference: str) -> str:
    """Build the filename for a synced item, from its title and its ID.

    The ID is always part of the name rather than a tie-breaker added on collision. A name
    derived from the title alone moves between items that share one: if the item holding the
    plain name fails, the other takes it and overwrites the file kept for the failed one.
    Titles are also truncated, since Notion allows far longer ones than a filename holds.
    """
    slug = re.sub(r"[^\w\s-]", "", title).strip().replace(" ", "-").lower()[:MAX_SLUG_LENGTH]
    identifier = short_reference(reference)

    return f"{slug}-{identifier}.md" if slug else f"{identifier}.md"


def create_client(api_key: str) -> Any:
    """Create a Notion client pinned to the API version nao relies on."""
    from nao_core.deps import require_dependency

    require_dependency("notion_client", "notion", "for Notion integration")
    require_dependency("notion2md", "notion", "for Notion integration")

    from notion_client import Client

    return Client(auth=api_key, notion_version=NOTION_API_VERSION)


def extract_page_title(page: dict[str, Any], page_id: str) -> str:
    """Read a page's title from its properties, falling back to its ID."""
    properties = page.get("properties", {})

    # Database rows name their title property freely (e.g. "Topic"), so match on the
    # property type rather than a list of conventional names.
    for title_prop in properties.values():
        if title_prop.get("type") == "title":
            title_array = title_prop.get("title", [])
            if title_array:
                return "".join(t.get("plain_text", "") for t in title_array)

    return page_id


def fetch_as_markdown(url: str, api_key: str) -> tuple[str, str, str]:
    """Fetch a Notion page or database and convert it to markdown.

    Databases are rendered as markdown tables. Pages keep their block content, with any
    inline database rendered in place of the marker notion2md leaves behind.

    Returns:
        Tuple of (object_id, title, markdown_body)
    """
    client = create_client(api_key)
    object_id = extract_notion_id(url)
    page = retrieve_page(client, object_id)

    if page is None:
        title, table = get_database_as_markdown(client, object_id, extract_view_id(url))
        return object_id, title, table

    title = extract_page_title(page, object_id)
    markdown = export_page_as_markdown(object_id, api_key)
    markdown = strip_images(markdown)
    markdown = inject_child_databases(client, object_id, markdown)

    return object_id, title, markdown


def export_page_as_markdown(object_id: str, api_key: str) -> str:
    """Export page blocks without dropping content whose optional icon is null."""
    from notion2md.convertor.block import BlockConvertor
    from notion2md.exporter.block import StringExporter

    class NotionBlockConvertor(BlockConvertor):
        def collect_info(self, payload: dict[str, Any]) -> dict[str, Any]:
            icon = payload.get("icon")
            if "icon" in payload and (not isinstance(icon, dict) or not isinstance(icon.get("emoji"), str)):
                payload = {**payload, "icon": {"emoji": ""}}
            return cast(dict[str, Any], super().collect_info(payload))

    exporter = StringExporter(block_id=object_id, token=api_key)
    exporter._block_convertor = NotionBlockConvertor(exporter.config, exporter._client, exporter.io)
    return cast(str, exporter.export())


def retrieve_page(client: Any, object_id: str) -> dict[str, Any] | None:
    """Retrieve a page, returning None when the ID refers to a database instead.

    Notion answers `validation_error` when the ID belongs to a database, and reserves
    `object_not_found` for an object that is missing or not shared with the integration.
    Only the former is a database, so every other error is raised rather than reported as
    a database that cannot be found. Unlike the database calls this one is not retried on
    purpose: a throttled page fails its own sync, which leaves its previous file untouched.
    """
    from notion_client.errors import APIErrorCode, APIResponseError

    try:
        return cast(dict[str, Any], client.pages.retrieve(page_id=object_id))
    except APIResponseError as error:
        if error.code != APIErrorCode.ValidationError:
            raise
        return None


def get_content_as_markdown(page_url: str, api_key: str) -> tuple[str, str]:
    """Fetch a Notion page or database as a markdown document with frontmatter.

    Returns:
        Tuple of (title, markdown_content)
    """
    object_id, title, markdown = fetch_as_markdown(page_url, api_key)

    return title, render_document(title, object_id, markdown)


def render_document(title: str, object_id: str, markdown: str) -> str:
    """Wrap markdown in YAML frontmatter.

    Titles are serialised rather than interpolated, so one containing a colon or starting
    with a comment marker stays a readable string instead of breaking every consumer of the
    frontmatter.
    """
    frontmatter = yaml.safe_dump({"title": title, "id": object_id}, sort_keys=False, allow_unicode=True).strip()

    return f"""---
{frontmatter}
---

{markdown}
"""


class NotionSyncProvider(SyncProvider):
    """Provider for syncing Notion pages and databases."""

    @property
    def name(self) -> str:
        return "Notion"

    @property
    def emoji(self) -> str:
        return "📝"

    @property
    def default_output_dir(self) -> str:
        return "docs/notion"

    def get_items(self, config: NaoConfig) -> list[NotionConfig]:
        return [config.notion] if config.notion else []

    def sync(
        self,
        items: list[NotionConfig],
        output_path: Path,
        project_path: Path | None = None,
        *,
        threads: int = 1,
    ) -> SyncResult:
        """Sync Notion pages to local filesystem as markdown files.

        Args:
            items: Notion configuration with pages to sync.
            output_path: Path where synced markdown files should be written.
            project_path: Path to the nao project root.
            threads: Number of worker threads to use.

        Returns:
            SyncResult with statistics about what was synced.
        """
        if not items:
            UI.print("\n[dim]No Notion pages configured[/dim]")
            return SyncResult(provider_name=self.name, items_synced=0, summary="No Notion configurations configured")

        notion_config = items[0]
        output_path.mkdir(parents=True, exist_ok=True)

        UI.print(f"\n[bold cyan]{self.emoji}  Syncing {self.name}[/bold cyan]")
        UI.print(f"[dim]Location:[/dim] {output_path.absolute()}\n")

        try:
            references, parent_references, truncated, discovery_failures = discover_documents(notion_config)
        except Exception as error:  # noqa: BLE001 - incomplete discovery must not delete existing context
            message = f"Failed to discover Notion pages: {error}"
            UI.print(f"[bold red]✗[/bold red] {escape(message)}")
            return SyncResult(
                provider_name=self.name,
                items_synced=0,
                details={"pages": [], "removed": 0},
                summary="No pages synced",
                error=message,
            )

        if truncated:
            UI.print(
                f"[yellow]⚠[/yellow]  Recursive Notion sync stopped at the configured limit of "
                f"{notion_config.max_pages} objects"
            )
        if threads > 1 and len(references) > 1:
            UI.print(f"[dim]Threads:[/dim] {threads}\n")

        api_key = notion_config.api_key

        documents, failed_pages = fetch_documents(references, api_key, threads)
        synced_files, synced_pages, write_failures = write_documents(documents, output_path, parent_references)
        pages_synced = len(synced_pages)
        failed_pages += write_failures

        removed_count = cleanup_if_fully_synced(
            failed_pages,
            synced_files,
            output_path,
            discovery_complete=not truncated and not discovery_failures,
        )

        summary = f"{pages_synced} pages synced as markdown"
        if removed_count > 0:
            summary += f", {removed_count} stale removed"
        page_label = "page" if failed_pages == 1 else "pages"
        error = f"Failed to sync {failed_pages} Notion {page_label}" if failed_pages else None
        if discovery_failures and error is None:
            branch_label = "branch" if discovery_failures == 1 else "branches"
            error = f"Failed to discover {discovery_failures} Notion {branch_label}"

        return SyncResult(
            provider_name=self.name,
            items_synced=pages_synced,
            details={"pages": synced_pages, "removed": removed_count},
            summary=summary,
            error=error,
        )
