import re
from pathlib import Path
from typing import Any, cast

from notion2md.exporter.block import StringExporter
from notion_client import Client
from rich.console import Console
from rich.progress import BarColumn, Progress, SpinnerColumn, TaskProgressColumn, TextColumn

from nao_core.config.base import NaoConfig
from nao_core.config.notion import NotionConfig

from ..base import SyncProvider, SyncResult

console = Console()

# Notion page IDs are 32-character hex strings (UUID without dashes)
NOTION_PAGE_ID_PATTERN = re.compile(r"[a-f0-9]{32}")


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


def extract_page_id(page_url: str) -> str:
    """Extract Notion page ID from a URL.

    Handles URLs like:
    - https://www.notion.so/naolabs/Conversational-analytics-2bfc7a70bc0680978900d1e85ece83a0
    - https://www.notion.so/2bfc7a70bc0680978900d1e85ece83a0
    - 2bfc7a70bc0680978900d1e85ece83a0 (raw ID)
    """
    match = NOTION_PAGE_ID_PATTERN.search(page_url)
    if match:
        return match.group(0)
    raise ValueError(f"Could not extract Notion page ID from: {page_url}")


def get_page_title(client: Client, page_id: str) -> str:
    """Get the title of a Notion page."""
    page = cast(dict[str, Any], client.pages.retrieve(page_id=page_id))
    properties = page.get("properties", {})

    # Try common title property names
    for prop_name in ["title", "Title", "Name", "name", "Page"]:
        if prop_name in properties:
            title_prop = properties[prop_name]
            if title_prop.get("type") == "title":
                title_array = title_prop.get("title", [])
                if title_array:
                    return "".join(t.get("plain_text", "") for t in title_array)

    # Fallback to page ID if no title found
    return page_id


def get_page_as_markdown(page_url: str, api_key: str) -> tuple[str, str]:
    """Fetch a Notion page and convert it to markdown.

    Returns:
        Tuple of (title, markdown_content)
    """
    page_id = extract_page_id(page_url)

    # Get page title for the filename
    client = Client(auth=api_key)
    title = get_page_title(client, page_id)

    # Export to markdown string using notion2md
    md_exporter = StringExporter(block_id=page_id, token=api_key)
    markdown = md_exporter.export()

    # Strip images since we can't read them
    markdown = strip_images(markdown)

    content = f"""---
title: {title}
id: {page_id}
---

{markdown}
"""

    return title, content


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

    def sync(self, items: list[NotionConfig], output_path: Path, project_path: Path | None = None) -> SyncResult:
        """Sync Notion pages to local filesystem as markdown files.

        Args:
            items: Notion configuration with pages to sync.
            output_path: Path where synced markdown files should be written.
            project_path: Path to the nao project root.

        Returns:
            SyncResult with statistics about what was synced.
        """
        if not items:
            console.print("\n[dim]No Notion pages configured[/dim]")
            return SyncResult(provider_name=self.name, items_synced=0, summary="No Notion configurations configured")

        notion_config = items[0]
        output_path.mkdir(parents=True, exist_ok=True)
        pages_synced = 0
        synced_pages: list[str] = []
        synced_files: set[str] = set()

        console.print(f"\n[bold cyan]{self.emoji}  Syncing {self.name}[/bold cyan]")
        console.print(f"[dim]Location:[/dim] {output_path.absolute()}\n")

        api_key = notion_config.api_key
        total_pages = len(notion_config.pages)

        with Progress(
            SpinnerColumn(style="dim"),
            TextColumn("[progress.description]{task.description}"),
            BarColumn(bar_width=30, style="dim", complete_style="cyan", finished_style="green"),
            TaskProgressColumn(),
            console=console,
            transient=False,
        ) as progress:
            task = progress.add_task("Syncing pages", total=total_pages)

            for page_url in notion_config.pages:
                try:
                    title, markdown = get_page_as_markdown(page_url, api_key)

                    # Sanitize title for filename
                    safe_title = re.sub(r"[^\w\s-]", "", title).strip().replace(" ", "-").lower()
                    filename = f"{safe_title}.md"

                    with open(output_path / filename, "w") as f:
                        f.write(markdown)

                    pages_synced += 1
                    synced_pages.append(title)
                    synced_files.add(filename)
                    progress.update(task, advance=1, description=f"Synced: {title}")
                except Exception as e:
                    console.print(f"[bold red]✗[/bold red] Failed to sync page {page_url}: {e}")
                    progress.update(task, advance=1)

        # Clean up stale pages
        removed_count = cleanup_stale_pages(synced_files, output_path, verbose=True)

        # Build summary
        summary = f"{pages_synced} pages synced as markdown"
        if removed_count > 0:
            summary += f", {removed_count} stale removed"

        return SyncResult(
            provider_name=self.name,
            items_synced=pages_synced,
            details={"pages": synced_pages, "removed": removed_count},
            summary=summary,
        )
