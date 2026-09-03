"""Unit tests for the Confluence sync provider."""

from pathlib import Path
from unittest.mock import patch

import pytest
import yaml

from nao_core.commands.sync.providers.confluence.client import Ancestor, ConfluencePage, PageRef, extract_page_id
from nao_core.commands.sync.providers.confluence.provider import (
    ConfluenceSyncProvider,
    build_label_cql,
    html_to_markdown,
    page_relative_path,
    quote_cql,
    read_existing_versions,
    read_frontmatter,
    render_document,
    segment,
)
from nao_core.config.confluence import ConfluenceConfig


def cloud_config(
    *,
    pages: list[str] | None = None,
    page_trees: list[str] | None = None,
    labels: list[str] | None = None,
    spaces: list[str] | None = None,
) -> ConfluenceConfig:
    return ConfluenceConfig(
        base_url="https://acme.atlassian.net/wiki",
        deployment="cloud",
        email="me@acme.com",
        api_token="secret",
        pages=pages or [],
        page_trees=page_trees or [],
        labels=labels or [],
        spaces=spaces or [],
    )


def page(
    page_id: str,
    title: str = "Page",
    version: int = 1,
    html: str = "<p>body</p>",
    content_type: str = "page",
    ancestors: list[Ancestor] | None = None,
) -> ConfluencePage:
    return ConfluencePage(
        id=page_id,
        title=title,
        space_key="ENG",
        version=version,
        html=html,
        url=f"https://acme.atlassian.net/wiki/pages/{page_id}",
        content_type=content_type,
        ancestors=ancestors or [],
    )


class FakeClient:
    """A stand-in for ConfluenceClient serving pages from memory and a fixed search result."""

    def __init__(self, pages: dict[str, ConfluencePage], search: list[PageRef] | None = None):
        self._pages = pages
        self._search = search or []
        self.fetched: list[str] = []

    def __enter__(self) -> "FakeClient":
        return self

    def __exit__(self, *_: object) -> None:
        pass

    def get_page(self, page_id: str) -> ConfluencePage:
        self.fetched.append(page_id)
        if page_id not in self._pages:
            raise RuntimeError(f"page {page_id} is unavailable")
        return self._pages[page_id]

    def search_refs(self, cql: str):
        return iter(self._search)


def patched(fake: FakeClient):
    return patch(
        "nao_core.commands.sync.providers.confluence.provider.ConfluenceClient",
        return_value=fake,
    )


def test_extract_page_id_reads_ids_and_urls():
    assert extract_page_id("123456") == "123456"
    assert extract_page_id("https://acme.atlassian.net/wiki/spaces/ENG/pages/123456/Runbook") == "123456"
    assert extract_page_id("https://confluence.acme.com/pages/viewpage.action?pageId=987654") == "987654"


def test_extract_page_id_rejects_a_title_only_url():
    with pytest.raises(ValueError):
        extract_page_id("https://confluence.acme.com/display/ENG/Runbook")


def test_segment_always_carries_the_page_id():
    assert segment("Runbook Details", "123456") == "runbook-details-123456"
    assert segment("!!!", "123456") == "123456"
    assert segment("", "123456") == "123456"


def test_page_relative_path_mirrors_the_tree():
    ancestors = [Ancestor("10", "Engineering"), Ancestor("20", "Runbooks")]
    path = page_relative_path(page("100", title="DB failover", ancestors=ancestors))

    assert path == Path("space=ENG/engineering-10/runbooks-20/db-failover-100.md")


def test_page_relative_path_places_a_root_page_directly_under_its_space():
    assert page_relative_path(page("100", title="Overview")) == Path("space=ENG/overview-100.md")


def test_page_relative_path_groups_blogposts_under_a_blog_folder():
    path = page_relative_path(page("100", title="Release notes", content_type="blogpost"))

    assert path == Path("space=ENG/blog/release-notes-100.md")


def test_html_to_markdown_converts_and_strips_images():
    markdown = html_to_markdown('<h1>Title</h1><p>Text</p><p><img src="https://x/att.png" alt="a"></p>')

    assert "# Title" in markdown
    assert "Text" in markdown
    assert "att.png" not in markdown
    assert "[image]" in markdown


def test_render_document_records_versioned_frontmatter():
    document = render_document(page("100", title="Runbook", version=7))

    meta = yaml.safe_load(document.split("---")[1])
    assert meta["id"] == "100"
    assert meta["title"] == "Runbook"
    assert meta["version"] == 7
    assert meta["space"] == "ENG"
    assert document.rstrip().endswith("body")


@pytest.mark.parametrize("title", ["Schema: Orders", "# Draft", "true", "2026-01-01", '"quoted"'])
def test_render_document_keeps_yaml_significant_titles_readable(title):
    meta = yaml.safe_load(render_document(page("100", title=title)).split("---")[1])
    assert meta["title"] == title


def test_build_label_cql_scopes_to_a_space_when_asked():
    assert build_label_cql("glossary") == 'label = "glossary" and type in (page, blogpost)'
    assert build_label_cql("DATA:glossary") == 'label = "glossary" and space = "DATA" and type in (page, blogpost)'


def test_build_label_cql_escapes_quotes_and_backslashes():
    assert build_label_cql('gl"ossary') == 'label = "gl\\"ossary" and type in (page, blogpost)'
    assert build_label_cql("SP\\ACE:tag") == 'label = "tag" and space = "SP\\\\ACE" and type in (page, blogpost)'


def test_quote_cql_wraps_and_escapes():
    assert quote_cql("ENG") == '"ENG"'
    assert quote_cql('a"b\\c') == '"a\\"b\\\\c"'


def test_read_frontmatter_keeps_a_title_that_contains_a_delimiter(tmp_path: Path):
    file_path = tmp_path / "page.md"
    file_path.write_text(render_document(page("100", title="Before --- After", version=9)), encoding="utf-8")

    meta = read_frontmatter(file_path)

    assert meta["title"] == "Before --- After"
    assert meta["version"] == 9


def test_read_existing_versions_walks_the_tree(tmp_path: Path):
    nested = tmp_path / "space=ENG" / "runbooks-20"
    nested.mkdir(parents=True)
    (nested / "db-failover-100.md").write_text(render_document(page("100", version=4)), encoding="utf-8")
    (tmp_path / "loose.md").write_text("no frontmatter here", encoding="utf-8")

    versions = read_existing_versions(tmp_path)

    assert versions["100"] == (nested / "db-failover-100.md", 4)
    assert "loose" not in versions


def test_sync_writes_explicit_pages_under_their_space(tmp_path: Path):
    provider = ConfluenceSyncProvider()
    fake = FakeClient({"100": page("100", title="Runbook")})

    with patched(fake):
        result = provider.sync([cloud_config(pages=["100"])], tmp_path)

    assert result.items_synced == 1
    assert (tmp_path / "space=ENG" / "runbook-100.md").exists()
    assert fake.fetched == ["100"]


def test_sync_expands_a_page_tree(tmp_path: Path):
    provider = ConfluenceSyncProvider()
    fake = FakeClient(
        {"100": page("100", title="Root"), "200": page("200", title="Child")},
        search=[PageRef("200", version=1)],
    )

    with patched(fake):
        result = provider.sync([cloud_config(page_trees=["100"])], tmp_path)

    assert sorted(fake.fetched) == ["100", "200"]
    assert result.items_synced == 2


def test_sync_pulls_pages_for_a_label(tmp_path: Path):
    provider = ConfluenceSyncProvider()
    fake = FakeClient({"100": page("100")}, search=[PageRef("100", version=1)])

    with patched(fake):
        result = provider.sync([cloud_config(labels=["data-catalog"])], tmp_path)

    assert fake.fetched == ["100"]
    assert result.items_synced == 1


def test_sync_skips_a_page_unchanged_since_last_run(tmp_path: Path):
    provider = ConfluenceSyncProvider()
    existing = tmp_path / "space=ENG"
    existing.mkdir(parents=True)
    (existing / "page-100.md").write_text(render_document(page("100", version=5)), encoding="utf-8")
    fake = FakeClient({"100": page("100", version=5)}, search=[PageRef("100", version=5)])

    with patched(fake):
        result = provider.sync([cloud_config(spaces=["ENG"])], tmp_path)

    assert fake.fetched == []
    assert result.details == {"synced": 0, "unchanged": 1, "removed": 0}


def test_sync_refetches_a_page_that_changed(tmp_path: Path):
    provider = ConfluenceSyncProvider()
    existing = tmp_path / "space=ENG"
    existing.mkdir(parents=True)
    (existing / "page-100.md").write_text(render_document(page("100", version=5)), encoding="utf-8")
    fake = FakeClient({"100": page("100", version=6)}, search=[PageRef("100", version=6)])

    with patched(fake):
        result = provider.sync([cloud_config(spaces=["ENG"])], tmp_path)

    assert fake.fetched == ["100"]
    assert result.details == {"synced": 1, "unchanged": 0, "removed": 0}


def test_sync_removes_stale_pages_and_prunes_empty_dirs(tmp_path: Path):
    provider = ConfluenceSyncProvider()
    stale_dir = tmp_path / "space=OLD" / "gone-999"
    stale_dir.mkdir(parents=True)
    (stale_dir / "stale-888.md").write_text("outdated", encoding="utf-8")
    fake = FakeClient({"100": page("100")})

    with patched(fake):
        result = provider.sync([cloud_config(pages=["100"])], tmp_path)

    assert not (stale_dir / "stale-888.md").exists()
    assert not (tmp_path / "space=OLD").exists()
    assert result.details is not None and result.details["removed"] == 1


def test_sync_keeps_existing_files_when_a_page_failed(tmp_path: Path):
    provider = ConfluenceSyncProvider()
    stale = tmp_path / "space=OLD"
    stale.mkdir(parents=True)
    (stale / "stale-999.md").write_text("outdated", encoding="utf-8")
    fake = FakeClient({"100": page("100")})

    with patched(fake):
        result = provider.sync([cloud_config(pages=["100", "404"])], tmp_path)

    assert (stale / "stale-999.md").read_text() == "outdated"
    assert result.details is not None and result.details["removed"] == 0


def test_sync_places_a_blogpost_under_blog(tmp_path: Path):
    provider = ConfluenceSyncProvider()
    fake = FakeClient({"100": page("100", title="Release", content_type="blogpost")})

    with patched(fake):
        provider.sync([cloud_config(pages=["100"])], tmp_path)

    assert (tmp_path / "space=ENG" / "blog" / "release-100.md").exists()


def test_sync_reports_nothing_to_sync_without_config(tmp_path: Path):
    result = ConfluenceSyncProvider().sync([], tmp_path)

    assert result.items_synced == 0
