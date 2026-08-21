"""Unit tests for the Notion sync provider."""

from pathlib import Path
from unittest.mock import MagicMock, patch

import httpx
import pytest
import yaml
from notion_client.errors import APIErrorCode, APIResponseError

from nao_core.commands.sync.providers.notion.database import DatabaseExportError
from nao_core.commands.sync.providers.notion.provider import (
    NotionSyncProvider,
    extract_notion_id,
    extract_page_title,
    extract_view_id,
    markdown_filename,
    render_document,
    retrieve_page,
    write_documents,
)
from nao_core.config.notion import NotionConfig


@patch("nao_core.commands.sync.providers.notion.provider.get_content_as_markdown")
def test_sync_pages_with_threads(mock_get_page, tmp_path: Path):
    provider = NotionSyncProvider()
    urls = ["https://notion.so/ws/" + "a" * 32, "https://notion.so/ws/" + "b" * 32]
    config = NotionConfig(api_key="secret", pages=urls)

    def _get_page(page_url: str, _api_key: str) -> tuple[str, str]:
        title = "Page A" if page_url == urls[0] else "Page B"
        return title, f"# {title}"

    mock_get_page.side_effect = _get_page

    result = provider.sync([config], tmp_path, threads=2)

    assert result.items_synced == 2
    assert (tmp_path / "page-a-aaaaaaaa.md").read_text() == "# Page A"
    assert (tmp_path / "page-b-bbbbbbbb.md").read_text() == "# Page B"
    assert mock_get_page.call_count == 2


@patch("nao_core.commands.sync.providers.notion.provider.get_content_as_markdown")
def test_sync_removes_stale_pages_when_everything_succeeded(mock_get_page, tmp_path: Path):
    provider = NotionSyncProvider()
    mock_get_page.return_value = ("Page A", "# Page A")
    (tmp_path / "stale.md").write_text("outdated")

    result = provider.sync([NotionConfig(api_key="secret", pages=["page-a"])], tmp_path)

    assert not (tmp_path / "stale.md").exists()
    assert result.details is not None
    assert result.details["removed"] == 1


@patch("nao_core.commands.sync.providers.notion.provider.get_content_as_markdown")
def test_sync_keeps_existing_pages_when_one_failed(mock_get_page, tmp_path: Path):
    provider = NotionSyncProvider()
    previously_synced = tmp_path / "page-b.md"
    previously_synced.write_text("# Page B")

    def _get_page(page_url: str, _api_key: str) -> tuple[str, str]:
        if page_url == "page-b":
            raise RuntimeError("rate limited")
        return "Page A", "# Page A"

    mock_get_page.side_effect = _get_page

    result = provider.sync([NotionConfig(api_key="secret", pages=["page-a", "page-b"])], tmp_path)

    assert previously_synced.read_text() == "# Page B"
    assert result.items_synced == 1
    assert result.details is not None
    assert result.details["removed"] == 0


def api_error(code: APIErrorCode, status: int) -> APIResponseError:
    return APIResponseError(code, status, str(code), httpx.Headers(), "")


def test_retrieve_page_reports_a_database_as_not_a_page():
    client = MagicMock()
    client.pages.retrieve.side_effect = api_error(APIErrorCode.ValidationError, 400)

    assert retrieve_page(client, "some-id") is None


def test_retrieve_page_raises_when_a_page_is_not_shared():
    client = MagicMock()
    client.pages.retrieve.side_effect = api_error(APIErrorCode.ObjectNotFound, 404)

    with pytest.raises(APIResponseError):
        retrieve_page(client, "some-id")


def test_retrieve_page_raises_when_rate_limited():
    client = MagicMock()
    client.pages.retrieve.side_effect = api_error(APIErrorCode.RateLimited, 429)

    with pytest.raises(APIResponseError):
        retrieve_page(client, "some-id")


def test_extract_view_id_reads_the_v_query_parameter():
    assert extract_view_id("https://notion.so/ws/35e5f0e8a00080c69a81ef456a2b174b?v=" + "a" * 32) == "a" * 32
    assert extract_view_id("https://notion.so/ws/35e5f0e8a00080c69a81ef456a2b174b") is None


def test_extract_notion_id_prefers_the_object_over_the_view():
    url = "https://notion.so/ws/marts-35e5f0e8a00080c69a81ef456a2b174b?v=" + "a" * 32

    assert extract_notion_id(url) == "35e5f0e8a00080c69a81ef456a2b174b"


def test_extract_page_title_reads_a_custom_named_title_property():
    page = {
        "properties": {
            "Owner": {"type": "people", "people": []},
            "Topic": {"type": "title", "title": [{"plain_text": "Basic "}, {"plain_text": "Knowledge"}]},
        }
    }

    assert extract_page_title(page, "35e5f0e8a00080c69a81ef456a2b174b") == "Basic Knowledge"


def test_extract_page_title_falls_back_to_the_id_when_the_title_is_empty():
    page = {"properties": {"Topic": {"type": "title", "title": []}}}

    assert extract_page_title(page, "35e5f0e8a00080c69a81ef456a2b174b") == "35e5f0e8a00080c69a81ef456a2b174b"


@pytest.mark.parametrize(
    "title",
    ["Schema: Orders", "# Draft", "true", "2026-01-01", "- dash", '"quoted"', "value #comment"],
)
def test_render_document_keeps_yaml_significant_titles_readable(title):
    document = render_document(title, "35e5f0e8a0008045bb12fee7746de807", "body")

    meta = yaml.safe_load(document.split("---")[1])
    assert meta["title"] == title
    assert meta["id"] == "35e5f0e8a0008045bb12fee7746de807"


def test_write_documents_gives_colliding_titles_distinct_files(tmp_path: Path):
    documents = [
        ("https://notion.so/ws/" + "a" * 32, "Overview", "first"),
        ("https://notion.so/ws/" + "b" * 32, "Overview", "second"),
    ]

    written, titles, failed = write_documents(documents, tmp_path)

    assert written == {"overview-aaaaaaaa.md", "overview-bbbbbbbb.md"}
    assert (tmp_path / "overview-aaaaaaaa.md").read_text() == "first"
    assert (tmp_path / "overview-bbbbbbbb.md").read_text() == "second"
    assert titles == ["Overview", "Overview"]
    assert failed == 0


def test_write_documents_names_an_item_the_same_way_whoever_else_succeeded(tmp_path: Path):
    alone = [("https://notion.so/ws/" + "b" * 32, "Overview", "second")]

    written, _, _ = write_documents(alone, tmp_path)

    assert written == {"overview-bbbbbbbb.md"}


def test_write_documents_keeps_a_write_failure_to_its_own_item(tmp_path: Path):
    documents = [
        ("https://notion.so/ws/" + "a" * 32, "A" * 300, "first"),
        ("https://notion.so/ws/" + "b" * 32, "Fine", "second"),
    ]

    written, titles, failed = write_documents(documents, tmp_path)

    assert "fine-bbbbbbbb.md" in written
    assert titles[-1] == "Fine"
    assert failed == 0


@patch("nao_core.commands.sync.providers.notion.provider.get_content_as_markdown")
def test_sync_survives_a_title_that_looks_like_console_markup(mock_get_page, tmp_path: Path):
    provider = NotionSyncProvider()
    mock_get_page.return_value = ("Notes [/done]", "# Notes")

    result = provider.sync([NotionConfig(api_key="secret", pages=["page-a"])], tmp_path)

    assert result.items_synced == 1


@patch("nao_core.commands.sync.providers.notion.provider.get_content_as_markdown")
def test_sync_survives_an_error_that_looks_like_console_markup(mock_get_page, tmp_path: Path):
    provider = NotionSyncProvider()
    mock_get_page.side_effect = RuntimeError("boom [/done]")

    result = provider.sync([NotionConfig(api_key="secret", pages=["page-a"])], tmp_path)

    assert result.items_synced == 0


def test_extract_ids_accept_dashed_uuids():
    dashed = "35e5f0e8-a000-80c6-9a81-ef456a2b174b"
    bare = "35e5f0e8a00080c69a81ef456a2b174b"

    assert extract_notion_id(dashed) == bare
    assert extract_notion_id(f"https://notion.so/ws/page-{bare}") == bare
    assert extract_view_id(f"https://notion.so/ws/{bare}?v={dashed}") == bare


def test_markdown_filename_always_carries_the_item_id():
    reference = "https://notion.so/ws/" + "a" * 32

    assert markdown_filename("Columns details", reference) == "columns-details-aaaaaaaa.md"
    assert markdown_filename("!!!", reference) == "aaaaaaaa.md"
    assert markdown_filename("", reference) == "aaaaaaaa.md"


def test_markdown_filename_separates_two_views_of_one_database():
    database = "https://notion.so/ws/" + "a" * 32
    first = markdown_filename("Columns", f"{database}?v=" + "b" * 32)
    second = markdown_filename("Columns", f"{database}?v=" + "c" * 32)

    assert first == "columns-aaaaaaaa-bbbbbbbb.md"
    assert second == "columns-aaaaaaaa-cccccccc.md"
    assert markdown_filename("Columns", database) == "columns-aaaaaaaa.md"


def test_write_documents_writes_utf8_whatever_the_platform_encoding(tmp_path: Path):
    body = "co2e_saved → gains — ⚠️ accentué"

    written, _, failed = write_documents([("https://notion.so/ws/" + "a" * 32, "Notes", body)], tmp_path)

    assert failed == 0
    assert (tmp_path / written.pop()).read_text(encoding="utf-8") == body


def test_write_documents_contains_an_encoding_failure(tmp_path: Path):
    documents = [
        ("https://notion.so/ws/" + "a" * 32, "Broken", "→"),
        ("https://notion.so/ws/" + "b" * 32, "Fine", "ok"),
    ]
    real_write = Path.write_text

    def write(self, data, *args, **kwargs):
        if "broken" in self.name:
            raise UnicodeEncodeError("cp1252", data, 0, 1, "unmappable character")
        return real_write(self, data, *args, **kwargs)

    with patch.object(Path, "write_text", write):
        written, titles, failed = write_documents(documents, tmp_path)

    assert failed == 1
    assert titles == ["Fine"]
    assert written == {"fine-bbbbbbbb.md"}


def test_markdown_filename_truncates_a_very_long_title():
    filename = markdown_filename("A" * 300, "https://notion.so/ws/" + "a" * 32)

    assert len(filename) < 100
    assert filename.endswith("-aaaaaaaa.md")


@patch("nao_core.commands.sync.providers.notion.provider.get_content_as_markdown")
def test_sync_keeps_a_page_untouched_when_its_inline_database_fails(mock_get_page, tmp_path: Path):
    provider = NotionSyncProvider()
    previously_synced = tmp_path / "page-a.md"
    previously_synced.write_text("# Page A\n\n| Name | Definition |")
    mock_get_page.side_effect = DatabaseExportError("inline database db-1 could not be exported: no access")

    result = provider.sync([NotionConfig(api_key="secret", pages=["page-a"])], tmp_path)

    assert previously_synced.read_text() == "# Page A\n\n| Name | Definition |"
    assert result.items_synced == 0
    assert result.details is not None
    assert result.details["removed"] == 0


def test_render_document_keeps_the_body_after_the_frontmatter():
    document = render_document("Title", "abc", "# Heading\n\ntext")

    assert document.startswith("---\n")
    assert document.endswith("# Heading\n\ntext\n")
