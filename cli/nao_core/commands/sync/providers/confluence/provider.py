import re
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from threading import Lock
from typing import Any

import yaml
from rich.console import Console
from rich.markup import escape
from rich.progress import BarColumn, Progress, SpinnerColumn, TaskProgressColumn, TextColumn

from nao_core.config.base import NaoConfig
from nao_core.config.confluence import ConfluenceConfig

from ..base import SyncProvider, SyncResult
from .client import ConfluenceClient, ConfluencePage, extract_page_id

console = Console()

# Confluence titles run far longer than a path segment usefully can
MAX_SLUG_LENGTH = 80

# Pattern to match markdown images: ![alt](url). Confluence images point at attachment URLs that
# need the same auth as the API, so the reference alone is of no use in the context layer.
IMAGE_PATTERN = re.compile(r"!\[[^\]]*\]\([^)]+\)\n?")

# Collapse the runs of blank lines that macro-wrapping divs leave behind once converted.
BLANK_LINES_PATTERN = re.compile(r"\n{3,}")

# YAML frontmatter: an opening `---` line, the metadata, then a closing `---` line. The delimiters
# are anchored to the start of a line so a `---` inside a title or URL is never mistaken for one.
FRONTMATTER_PATTERN = re.compile(r"\A---\n(.*?)\n---(?:\n|$)", re.DOTALL)

# Pages and blog posts are the content types nao reads. Other kinds a space holds (whiteboards,
# databases, attachments) carry no text the API exposes, so they are left out of every search.
READABLE_TYPES = "type in (page, blogpost)"


def strip_images(markdown: str) -> str:
    """Replace markdown image references with a placeholder."""
    return IMAGE_PATTERN.sub("[image]\n", markdown)


def html_to_markdown(html: str) -> str:
    """Convert Confluence's rendered HTML body to markdown."""
    from nao_core.deps import require_dependency

    require_dependency("markdownify", "confluence", "for Confluence integration")

    from markdownify import markdownify

    markdown = markdownify(html, heading_style="ATX")
    markdown = strip_images(markdown)
    return BLANK_LINES_PATTERN.sub("\n\n", markdown).strip()


def slug(title: str) -> str:
    """Reduce a title to a filesystem-safe, lowercase fragment."""
    return re.sub(r"[^\w\s-]", "", title).strip().replace(" ", "-").lower()[:MAX_SLUG_LENGTH]


def segment(title: str, page_id: str) -> str:
    """A path segment for a page, always carrying its ID so two pages never collide."""
    stub = slug(title)
    return f"{stub}-{page_id}" if stub else page_id


def page_relative_path(page: ConfluencePage) -> Path:
    """Where a page's markdown lives, mirroring its place in the Confluence tree.

    A page sits under its space, then under a directory for each of its ancestors, so the folder
    layout reads like the space's page tree. A page that itself has synced children keeps its body
    in a file beside the directory that holds them (`runbooks-100.md` next to `runbooks-100/`).
    Blog posts have no page tree, so they collect under a single `blog/` directory per space.
    """
    space = page.space_key or "unknown"
    leaf = f"{segment(page.title, page.id)}.md"

    if page.content_type == "blogpost":
        return Path(f"space={space}") / "blog" / leaf

    ancestors = [segment(ancestor.title, ancestor.id) for ancestor in page.ancestors]
    return Path(f"space={space}", *ancestors, leaf)


def render_document(page: ConfluencePage) -> str:
    """Wrap a page's markdown body in YAML frontmatter.

    The version is recorded so a later run can tell an unchanged page from an edited one and skip
    re-fetching its body. Values are serialised rather than interpolated, so a title with a colon
    stays a readable string instead of breaking every consumer of the frontmatter.
    """
    meta: dict[str, Any] = {
        "title": page.title,
        "id": page.id,
        "space": page.space_key,
        "version": page.version,
        "url": page.url,
    }
    frontmatter = yaml.safe_dump(meta, sort_keys=False, allow_unicode=True).strip()

    return f"""---
{frontmatter}
---

{html_to_markdown(page.html)}
"""


def read_existing_versions(output_path: Path) -> dict[str, tuple[Path, int]]:
    """Map each already-synced page ID to its file and the version stored in its frontmatter.

    The whole tree is walked, since a page's file can sit at any depth. A page whose frontmatter
    cannot be read is left out: it is then treated as new and re-fetched, which is safe, where
    trusting a half-read version could skip a real update.
    """
    versions: dict[str, tuple[Path, int]] = {}
    if not output_path.exists():
        return versions

    for file_path in output_path.rglob("*.md"):
        meta = read_frontmatter(file_path)
        page_id = meta.get("id")
        version = meta.get("version")
        if page_id is not None and isinstance(version, int):
            versions[str(page_id)] = (file_path, version)

    return versions


def read_frontmatter(file_path: Path) -> dict[str, Any]:
    """Read the YAML frontmatter of a markdown file, returning an empty dict when absent."""
    try:
        content = file_path.read_text(encoding="utf-8")
    except (OSError, UnicodeError):
        return {}

    match = FRONTMATTER_PATTERN.match(content)
    if not match:
        return {}

    try:
        meta = yaml.safe_load(match.group(1))
    except yaml.YAMLError:
        return {}

    return meta if isinstance(meta, dict) else {}


def quote_cql(value: str) -> str:
    """Quote a value as a CQL string literal, escaping the backslash and quote it reserves.

    CQL wraps string literals in double quotes and escapes both `\\` and `"` with a backslash, so a
    space key or label carrying either character keeps its literal meaning instead of terminating
    the literal early and turning the rest of the query into syntax Confluence rejects.
    """
    escaped = value.replace("\\", "\\\\").replace('"', '\\"')
    return f'"{escaped}"'


def build_label_cql(label: str) -> str:
    """Build the CQL for a label, honouring the optional `SPACE:label` scoping."""
    if ":" in label:
        space, name = label.split(":", 1)
        return f"label = {quote_cql(name)} and space = {quote_cql(space)} and {READABLE_TYPES}"
    return f"label = {quote_cql(label)} and {READABLE_TYPES}"


def gather_page_refs(client: ConfluenceClient, config: ConfluenceConfig) -> dict[str, int | None]:
    """Collect every page to sync, keyed by ID, keeping the version when a search revealed it.

    A page named on its own — or the root of a tree — carries no version hint, so its value is
    None and it is always fetched. A page reached through a search carries the version the search
    reported, which lets an unchanged one be skipped. The first known version for an ID wins.
    """
    refs: dict[str, int | None] = {}

    def note(page_id: str, version: int | None) -> None:
        if page_id not in refs or (refs[page_id] is None and version is not None):
            refs[page_id] = version

    for reference in config.pages:
        note(extract_page_id(reference), None)

    for reference in config.page_trees:
        root = extract_page_id(reference)
        note(root, None)
        for ref in client.search_refs(f"ancestor = {root} and type = page"):
            note(ref.id, ref.version)

    for label in config.labels:
        for ref in client.search_refs(build_label_cql(label)):
            note(ref.id, ref.version)

    for space in config.spaces:
        for ref in client.search_refs(f"space = {quote_cql(space)} and {READABLE_TYPES}"):
            note(ref.id, ref.version)

    return refs


def fetch_pages(client: ConfluenceClient, page_ids: list[str], threads: int) -> tuple[list[ConfluencePage], int]:
    """Fetch each page's body, keeping a failure to the single page it belongs to."""
    pages: dict[str, ConfluencePage] = {}
    failed = 0
    lock = Lock()

    with Progress(
        SpinnerColumn(style="dim"),
        TextColumn("[progress.description]{task.description}"),
        BarColumn(bar_width=30, style="dim", complete_style="cyan", finished_style="green"),
        TaskProgressColumn(),
        console=console,
        transient=False,
    ) as progress:
        task = progress.add_task("Syncing pages", total=len(page_ids))

        def record(page_id: str) -> None:
            """Fetch one page. Runs under threads, so shared state is mutated behind a lock."""
            nonlocal failed
            try:
                page = client.get_page(page_id)
            except Exception as error:  # noqa: BLE001 - one unreadable page must not stop the rest
                with lock:
                    failed += 1
                console.print(f"[bold red]✗[/bold red] Failed to sync page {escape(page_id)}: {escape(str(error))}")
                progress.update(task, advance=1)
                return

            with lock:
                pages[page_id] = page
            progress.update(task, advance=1, description=f"Synced: {escape(page.title)}")

        if threads <= 1 or len(page_ids) == 1:
            for page_id in page_ids:
                record(page_id)
        else:
            with ThreadPoolExecutor(max_workers=min(threads, len(page_ids))) as executor:
                list(executor.map(record, page_ids))

    return [pages[page_id] for page_id in page_ids if page_id in pages], failed


def write_documents(pages: list[ConfluencePage], output_path: Path) -> tuple[set[Path], int]:
    """Write fetched pages at their hierarchical path, keeping a write failure to its own page."""
    written: set[Path] = set()
    failed = 0

    for page in pages:
        relative = page_relative_path(page)
        target = output_path / relative
        try:
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text(render_document(page), encoding="utf-8")
        except (OSError, UnicodeError) as error:
            failed += 1
            console.print(f"[bold red]✗[/bold red] Failed to write {escape(str(relative))}: {escape(str(error))}")
            continue
        written.add(target.resolve())

    return written, failed


def cleanup_stale_pages(kept: set[Path], output_path: Path, verbose: bool = False) -> int:
    """Remove markdown files that were not part of this sync, then prune the folders left empty."""
    if not output_path.exists():
        return 0

    removed_count = 0
    for file_path in output_path.rglob("*.md"):
        if file_path.resolve() not in kept:
            file_path.unlink()
            removed_count += 1
            if verbose:
                console.print(f"  [dim red]removing stale page:[/dim red] {file_path.relative_to(output_path)}")

    prune_empty_dirs(output_path)
    return removed_count


def prune_empty_dirs(root: Path) -> None:
    """Remove directories left empty once stale files are gone, deepest first."""
    for directory in sorted((p for p in root.rglob("*") if p.is_dir()), key=lambda p: len(p.parts), reverse=True):
        if not any(directory.iterdir()):
            directory.rmdir()


def cleanup_if_fully_synced(failed_pages: int, kept: set[Path], output_path: Path) -> int:
    """Remove stale markdown only when every page synced.

    A page that failed is absent from the kept set, so cleaning up after a partial run would
    delete markdown that is still good, losing content to what is often a transient error.
    """
    if failed_pages:
        console.print(
            f"[yellow]⚠[/yellow]  Keeping existing files: {failed_pages} page(s) failed, so stale ones were "
            "left in place and will remain until a run succeeds in full"
        )
        return 0

    return cleanup_stale_pages(kept, output_path, verbose=True)


class ConfluenceSyncProvider(SyncProvider):
    """Provider for syncing Confluence pages, trees, labels and spaces."""

    @property
    def name(self) -> str:
        return "Confluence"

    @property
    def emoji(self) -> str:
        return "📘"

    @property
    def default_output_dir(self) -> str:
        return "docs/confluence"

    def get_items(self, config: NaoConfig) -> list[ConfluenceConfig]:
        return [config.confluence] if config.confluence else []

    def sync(
        self,
        items: list[ConfluenceConfig],
        output_path: Path,
        project_path: Path | None = None,
        *,
        threads: int = 1,
    ) -> SyncResult:
        """Sync Confluence content to the local filesystem as markdown files.

        Pages named explicitly, whole subtrees, labels and spaces are resolved to a single set of
        pages, then any page unchanged since its last sync is kept where it is and only changed or
        new pages are fetched. Each page is written under a path that mirrors its place in the
        Confluence tree. Stale files are removed once, and only when the run succeeded in full.
        """
        if not items:
            return SyncResult(provider_name=self.name, items_synced=0, summary="No Confluence configuration configured")

        config = items[0]
        output_path.mkdir(parents=True, exist_ok=True)

        console.print(f"\n[bold cyan]{self.emoji}  Syncing {self.name}[/bold cyan]")
        console.print(f"[dim]Location:[/dim] {output_path.absolute()}\n")

        with ConfluenceClient(config) as client:
            refs = gather_page_refs(client, config)
            existing = read_existing_versions(output_path)

            reused, to_fetch = self._partition(refs, existing)
            pages, fetch_failures = fetch_pages(client, to_fetch, threads)

        written, write_failures = write_documents(pages, output_path)
        failed_pages = fetch_failures + write_failures

        kept = written | reused
        removed_count = cleanup_if_fully_synced(failed_pages, kept, output_path)

        pages_synced = len(kept)
        summary = f"{pages_synced} pages synced as markdown"
        if reused:
            summary += f", {len(reused)} unchanged"
        if removed_count:
            summary += f", {removed_count} stale removed"

        return SyncResult(
            provider_name=self.name,
            items_synced=pages_synced,
            details={"synced": len(written), "unchanged": len(reused), "removed": removed_count},
            summary=summary,
        )

    @staticmethod
    def _partition(refs: dict[str, int | None], existing: dict[str, tuple[Path, int]]) -> tuple[set[Path], list[str]]:
        """Split pages into those kept unchanged and those that must be fetched."""
        reused: set[Path] = set()
        to_fetch: list[str] = []

        for page_id, version in refs.items():
            known = existing.get(page_id)
            if version is not None and known is not None and known[1] == version:
                reused.add(known[0].resolve())
            else:
                to_fetch.append(page_id)

        return reused, to_fetch
