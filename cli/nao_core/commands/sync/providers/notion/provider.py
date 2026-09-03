import re
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

from ..base import SyncProvider, SyncResult
from .database import get_database_as_markdown, inject_child_databases

console = Console()

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
        synced_files: Set of filenames that were synced in this run.
        output_path: Path where synced markdown files are stored.
        verbose: Whether to print cleanup messages.

    Returns:
        Number of stale files removed.
    """
    if not output_path.exists():
        return 0

    removed_count = 0
    for file_path in output_path.iterdir():
        if file_path.is_file() and file_path.suffix == ".md":
            if file_path.name not in synced_files:
                file_path.unlink()
                removed_count += 1
                if verbose:
                    console.print(f"  [dim red]removing stale page:[/dim red] {file_path.name}")

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


def cleanup_if_fully_synced(failed_pages: int, synced_files: set[str], output_path: Path) -> int:
    """Remove stale markdown only when every page synced.

    A page that failed is absent from the synced set, so cleaning up after a partial run would
    delete markdown that is still good, losing content to what is often a transient error.
    Files no longer in Notion therefore survive until every page syncs again.
    """
    if failed_pages:
        console.print(
            f"[yellow]⚠[/yellow]  Keeping existing files: {failed_pages} page(s) failed, so stale ones were "
            "left in place and will remain until a run succeeds in full"
        )
        return 0

    return cleanup_stale_pages(synced_files, output_path, verbose=True)


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
                console.print(f"[bold red]✗[/bold red] Failed to sync page {escape(page_url)}: {escape(str(error))}")
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


def write_documents(documents: list[tuple[str, str, str]], output_path: Path) -> tuple[set[str], list[str], int]:
    """Write fetched documents, keeping a write failure to the item it belongs to.

    Notion content is written as UTF-8 rather than in the platform encoding, which would fail
    on the arrows, dashes and emoji it routinely contains. An encoding failure is not an
    OSError, so it is caught explicitly rather than escaping the whole write phase.
    """
    written: set[str] = set()
    titles: list[str] = []
    failed = 0

    for reference, title, markdown in documents:
        filename = markdown_filename(title, reference)
        try:
            (output_path / filename).write_text(markdown, encoding="utf-8")
        except (OSError, UnicodeError) as error:
            failed += 1
            console.print(f"[bold red]✗[/bold red] Failed to write {escape(filename)}: {escape(str(error))}")
            continue

        written.add(filename)
        titles.append(title)

    return written, titles, failed


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

    from notion2md.exporter.block import StringExporter

    title = extract_page_title(page, object_id)
    markdown = StringExporter(block_id=object_id, token=api_key).export()
    markdown = strip_images(markdown)
    markdown = inject_child_databases(client, object_id, markdown)

    return object_id, title, markdown


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
            console.print("\n[dim]No Notion pages configured[/dim]")
            return SyncResult(provider_name=self.name, items_synced=0, summary="No Notion configurations configured")

        notion_config = items[0]
        output_path.mkdir(parents=True, exist_ok=True)

        console.print(f"\n[bold cyan]{self.emoji}  Syncing {self.name}[/bold cyan]")
        console.print(f"[dim]Location:[/dim] {output_path.absolute()}\n")
        if threads > 1 and len(notion_config.pages) > 1:
            console.print(f"[dim]Threads:[/dim] {threads}\n")

        api_key = notion_config.api_key

        documents, failed_pages = fetch_documents(notion_config.pages, api_key, threads)
        synced_files, synced_pages, write_failures = write_documents(documents, output_path)
        pages_synced = len(synced_pages)
        failed_pages += write_failures

        removed_count = cleanup_if_fully_synced(failed_pages, synced_files, output_path)

        summary = f"{pages_synced} pages synced as markdown"
        if removed_count > 0:
            summary += f", {removed_count} stale removed"

        return SyncResult(
            provider_name=self.name,
            items_synced=pages_synced,
            details={"pages": synced_pages, "removed": removed_count},
            summary=summary,
        )
