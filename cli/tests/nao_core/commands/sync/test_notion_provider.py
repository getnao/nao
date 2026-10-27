"""Unit tests for the Notion sync provider."""

import logging
from pathlib import Path
from unittest.mock import MagicMock, patch

import httpx
import pytest
import yaml
from notion_client.errors import APIErrorCode, APIResponseError

from nao_core.commands.sync.providers.notion.database import DatabaseExportError, DatabaseRows
from nao_core.commands.sync.providers.notion.provider import (
    NotionSyncProvider,
    discover_documents,
    export_page_as_markdown,
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
    config = NotionConfig(api_key="secret", pages=urls, max_depth=0)

    def _get_page(page_url: str, _api_key: str) -> tuple[str, str]:
        title = "Page A" if page_url == urls[0] else "Page B"
        return title, f"# {title}"

    mock_get_page.side_effect = _get_page

    result = provider.sync([config], tmp_path, threads=2)

    assert result.items_synced == 2
    assert (tmp_path / "page-a-aaaaaaaa.md").read_text() == "# Page A"
    assert (tmp_path / "page-b-bbbbbbbb.md").read_text() == "# Page B"
    assert mock_get_page.call_count == 2


@patch("nao_core.commands.sync.providers.notion.provider.discover_documents")
@patch("nao_core.commands.sync.providers.notion.provider.get_content_as_markdown")
def test_sync_writes_discovered_pages_separately_and_keeps_parent_links(mock_get_page, mock_discover, tmp_path: Path):
    parent, child = ("a" * 32, "b" * 32)
    parent_link = f"[Child](https://www.notion.so/{child})"
    mock_discover.return_value = ([parent, child], {child: parent}, False)
    mock_get_page.side_effect = [
        ("Parent", f"# Parent\n\n{parent_link}"),
        ("Child", "# Child\n\nDetails"),
    ]

    result = NotionSyncProvider().sync(
        [NotionConfig(api_key="secret", pages=[parent])],
        tmp_path,
    )

    assert result.items_synced == 2
    assert {path.relative_to(tmp_path).as_posix() for path in tmp_path.rglob("*.md")} == {
        "parent-aaaaaaaa.md",
        "parent-aaaaaaaa/child-bbbbbbbb.md",
    }
    assert parent_link in (tmp_path / "parent-aaaaaaaa.md").read_text()
    assert (tmp_path / "parent-aaaaaaaa" / "child-bbbbbbbb.md").read_text() == "# Child\n\nDetails"


@patch("nao_core.commands.sync.providers.notion.provider.UI.print")
@patch("nao_core.commands.sync.providers.notion.provider.discover_documents")
@patch("nao_core.commands.sync.providers.notion.provider.get_content_as_markdown")
def test_sync_warns_when_recursive_discovery_is_truncated(mock_get_page, mock_discover, mock_print, tmp_path: Path):
    root = "a" * 32
    stale = tmp_path / "stale.md"
    stale.write_text("keep me")
    mock_discover.return_value = ([root], {}, True)
    mock_get_page.return_value = ("Root", "# Root")

    result = NotionSyncProvider().sync(
        [NotionConfig(api_key="secret", pages=[root], max_pages=1)],
        tmp_path,
    )

    assert any("configured limit of 1 objects" in call.args[0] for call in mock_print.call_args_list)
    assert stale.read_text() == "keep me"
    assert result.details is not None
    assert result.details["removed"] == 0


@patch("nao_core.commands.sync.providers.notion.provider.discover_documents")
def test_sync_keeps_existing_files_when_recursive_discovery_fails(mock_discover, tmp_path: Path):
    existing = tmp_path / "child-bbbbbbbb.md"
    existing.write_text("previous content")
    mock_discover.side_effect = RuntimeError("rate limited")

    result = NotionSyncProvider().sync(
        [NotionConfig(api_key="secret", pages=["a" * 32])],
        tmp_path,
    )

    assert existing.read_text() == "previous content"
    assert result.items_synced == 0
    assert result.details == {"pages": [], "removed": 0}
    assert result.error == "Failed to discover Notion pages: rate limited"


@patch("nao_core.commands.sync.providers.notion.provider.discover_documents")
@patch("nao_core.commands.sync.providers.notion.provider.get_content_as_markdown")
def test_sync_keeps_existing_descendants_when_one_fetch_fails(mock_get_page, mock_discover, tmp_path: Path):
    parent, child = ("a" * 32, "b" * 32)
    existing_child = tmp_path / "parent-aaaaaaaa" / "child-bbbbbbbb.md"
    existing_child.parent.mkdir()
    existing_child.write_text("previous child content")
    mock_discover.return_value = ([parent, child], {child: parent}, False)
    mock_get_page.side_effect = [
        ("Parent", "# Parent"),
        RuntimeError("rate limited"),
    ]

    result = NotionSyncProvider().sync(
        [NotionConfig(api_key="secret", pages=[parent])],
        tmp_path,
    )

    assert existing_child.read_text() == "previous child content"
    assert result.items_synced == 1
    assert result.details is not None
    assert result.details["removed"] == 0
    assert result.error == "Failed to sync 1 Notion page"


@patch("nao_core.commands.sync.providers.notion.provider.discover_documents")
@patch("nao_core.commands.sync.providers.notion.provider.get_content_as_markdown")
def test_sync_removes_descendants_deleted_from_notion_after_a_successful_sync(
    mock_get_page, mock_discover, tmp_path: Path
):
    parent = "a" * 32
    deleted_child = tmp_path / "parent-aaaaaaaa" / "child-bbbbbbbb.md"
    deleted_child.parent.mkdir()
    deleted_child.write_text("deleted child content")
    mock_discover.return_value = ([parent], {}, False)
    mock_get_page.return_value = ("Parent", "# Parent")

    result = NotionSyncProvider().sync(
        [NotionConfig(api_key="secret", pages=[parent])],
        tmp_path,
    )

    assert not deleted_child.exists()
    assert not deleted_child.parent.exists()
    assert result.items_synced == 1
    assert result.details is not None
    assert result.details["removed"] == 1


@patch("nao_core.commands.sync.providers.notion.provider.get_content_as_markdown")
def test_sync_removes_stale_pages_when_everything_succeeded(mock_get_page, tmp_path: Path):
    provider = NotionSyncProvider()
    mock_get_page.return_value = ("Page A", "# Page A")
    (tmp_path / "stale.md").write_text("outdated")

    result = provider.sync([NotionConfig(api_key="secret", pages=["page-a"], max_depth=0)], tmp_path)

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

    result = provider.sync(
        [NotionConfig(api_key="secret", pages=["page-a", "page-b"], max_depth=0)],
        tmp_path,
    )

    assert previously_synced.read_text() == "# Page B"
    assert result.items_synced == 1
    assert result.details is not None
    assert result.details["removed"] == 0
    assert result.error == "Failed to sync 1 Notion page"


def api_error(code: APIErrorCode, status: int) -> APIResponseError:
    return APIResponseError(code, status, str(code), httpx.Headers(), "")


@patch("nao_core.commands.sync.providers.notion.provider.create_client")
def test_discover_documents_walks_child_pages_breadth_first(mock_create_client):
    root, first, second, grandchild = ("a" * 32, "b" * 32, "c" * 32, "d" * 32)
    client = mock_create_client.return_value
    client.pages.retrieve.return_value = {"properties": {}}

    def list_children(block_id, **_kwargs):
        blocks = {
            root: [
                {"id": first, "type": "child_page", "has_children": True},
                {"id": "column", "type": "column_list", "has_children": True},
            ],
            "column": [{"id": second, "type": "child_page", "has_children": True}],
            first: [{"id": grandchild, "type": "child_page", "has_children": False}],
        }
        return {"results": blocks.get(block_id, []), "has_more": False}

    client.blocks.children.list.side_effect = list_children
    config = NotionConfig(api_key="secret", pages=[root], max_depth=2)

    references, parents, truncated = discover_documents(config)

    assert references == [root, first, second, grandchild]
    assert parents == {first: root, second: root, grandchild: first}
    assert not truncated


@patch("nao_core.commands.sync.providers.notion.provider.create_client")
def test_discover_documents_deduplicates_and_stops_at_the_page_limit(mock_create_client):
    root, child, omitted = ("a" * 32, "b" * 32, "c" * 32)
    client = mock_create_client.return_value
    client.pages.retrieve.return_value = {"properties": {}}
    client.blocks.children.list.side_effect = [
        {
            "results": [
                {"id": child, "type": "child_page", "has_children": False},
                {"id": child, "type": "child_page", "has_children": False},
                {"id": omitted, "type": "child_page", "has_children": False},
            ],
            "has_more": False,
        },
        {"results": [], "has_more": False},
    ]
    config = NotionConfig(api_key="secret", pages=[root], max_pages=1)

    references, parents, truncated = discover_documents(config)

    assert references == [root, child]
    assert parents == {child: root}
    assert truncated


@patch("nao_core.commands.sync.providers.notion.provider.create_client")
def test_discover_documents_stops_at_the_depth_limit(mock_create_client):
    root, child = ("a" * 32, "b" * 32)
    client = mock_create_client.return_value
    client.pages.retrieve.return_value = {"properties": {}}
    client.blocks.children.list.return_value = {
        "results": [{"id": child, "type": "child_page", "has_children": True}],
        "has_more": False,
    }
    config = NotionConfig(api_key="secret", pages=[root], max_depth=1)

    references, parents, truncated = discover_documents(config)

    assert references == [root, child]
    assert parents == {child: root}
    assert not truncated
    assert client.blocks.children.list.call_count == 1


@patch("nao_core.commands.sync.providers.notion.provider.create_client")
def test_discover_documents_includes_database_entries(mock_create_client):
    database, first, second = ("a" * 32, "b" * 32, "c" * 32)
    client = mock_create_client.return_value

    def retrieve_page(page_id):
        if page_id == database:
            raise api_error(APIErrorCode.ValidationError, 400)
        return {"id": page_id, "properties": {}}

    client.pages.retrieve.side_effect = retrieve_page
    client.databases.retrieve.return_value = {"id": database, "data_sources": [{"id": "source"}]}
    client.data_sources.query.return_value = {
        "results": [
            {
                "id": first,
                "properties": {"Name": {"type": "title", "title": [{"plain_text": "First"}]}},
            },
            {
                "id": second,
                "properties": {"Name": {"type": "title", "title": [{"plain_text": "Second"}]}},
            },
        ],
        "has_more": False,
    }
    client.blocks.children.list.return_value = {"results": [], "has_more": False}
    config = NotionConfig(api_key="secret", pages=[database])

    references, parents, truncated = discover_documents(config)

    assert references == [database, first, second]
    assert parents == {first: database, second: database}
    assert not truncated


@patch("nao_core.commands.sync.providers.notion.provider.fetch_rows")
@patch("nao_core.commands.sync.providers.notion.provider.create_client")
def test_discover_documents_traverses_each_configured_database_view(mock_create_client, mock_fetch_rows):
    database, first_view, second_view = ("a" * 32, "b" * 32, "c" * 32)
    shared, first_only, second_only = ("d" * 32, "e" * 32, "f" * 32)
    first_reference = f"https://notion.so/{database}?v={first_view}"
    second_reference = f"https://notion.so/{database}?v={second_view}"
    client = mock_create_client.return_value
    client.pages.retrieve.side_effect = api_error(APIErrorCode.ValidationError, 400)
    client.databases.retrieve.return_value = {"id": database, "data_sources": [{"id": "source"}]}

    def database_rows(_client, _database, view_id):
        row_ids = [shared, first_only] if view_id == first_view else [shared, second_only]
        return DatabaseRows(
            rows=[
                {"id": row_id, "properties": {"Name": {"type": "title", "title": [{"plain_text": row_id}]}}}
                for row_id in row_ids
            ],
            total=len(row_ids),
            complete=True,
        )

    mock_fetch_rows.side_effect = database_rows

    references, parents, truncated = discover_documents(
        NotionConfig(api_key="secret", pages=[first_reference, second_reference])
    )

    assert references == [first_reference, second_reference, shared, first_only, second_only]
    assert parents == {shared: first_reference, first_only: first_reference, second_only: second_reference}
    assert not truncated
    assert [call.args[2] for call in mock_fetch_rows.call_args_list] == [first_view, second_view]


@patch("nao_core.commands.sync.providers.notion.provider.fetch_rows")
@patch("nao_core.commands.sync.providers.notion.provider.create_client")
def test_discover_documents_marks_an_incomplete_database_scan_as_truncated(mock_create_client, mock_fetch_rows):
    database, row = ("a" * 32, "b" * 32)
    client = mock_create_client.return_value
    client.pages.retrieve.side_effect = api_error(APIErrorCode.ValidationError, 400)
    client.databases.retrieve.return_value = {"id": database, "data_sources": [{"id": "source"}]}
    mock_fetch_rows.return_value = DatabaseRows(
        rows=[{"id": row, "properties": {"Name": {"type": "title", "title": [{"plain_text": "Row"}]}}}],
        total=None,
        complete=False,
    )

    references, parents, truncated = discover_documents(NotionConfig(api_key="secret", pages=[database]))

    assert references == [database, row]
    assert parents == {row: database}
    assert truncated


@patch("nao_core.commands.sync.providers.notion.provider.create_client")
def test_discover_documents_skips_only_completely_empty_database_rows(mock_create_client):
    database, empty, untitled_with_body = ("a" * 32, "b" * 32, "c" * 32)
    client = mock_create_client.return_value

    def retrieve_page(page_id):
        if page_id == database:
            raise api_error(APIErrorCode.ValidationError, 400)
        return {"id": page_id, "properties": {}}

    def list_children(block_id, **_kwargs):
        blocks = {
            untitled_with_body: [{"id": "paragraph", "type": "paragraph", "has_children": False}],
        }
        return {"results": blocks.get(block_id, []), "has_more": False}

    client.pages.retrieve.side_effect = retrieve_page
    client.databases.retrieve.return_value = {"id": database, "data_sources": [{"id": "source"}]}
    client.data_sources.query.return_value = {
        "results": [
            {"id": empty, "properties": {"Name": {"type": "title", "title": []}}},
            {"id": untitled_with_body, "properties": {"Name": {"type": "title", "title": []}}},
        ],
        "has_more": False,
    }
    client.blocks.children.list.side_effect = list_children

    references, parents, truncated = discover_documents(NotionConfig(api_key="secret", pages=[database]))

    assert references == [database, untitled_with_body]
    assert parents == {untitled_with_body: database}
    assert not truncated


@patch("nao_core.commands.sync.providers.notion.provider.create_client")
def test_discover_documents_does_not_follow_links_or_embedded_databases(mock_create_client):
    root, linked_page, embedded_database = ("a" * 32, "b" * 32, "c" * 32)
    client = mock_create_client.return_value
    client.pages.retrieve.return_value = {"id": root, "properties": {}}
    client.blocks.children.list.return_value = {
        "results": [
            {
                "id": "paragraph",
                "type": "paragraph",
                "has_children": False,
                "paragraph": {"rich_text": [{"href": f"https://www.notion.so/{linked_page}"}]},
            },
            {"id": embedded_database, "type": "child_database", "has_children": False},
        ],
        "has_more": False,
    }

    references, parents, truncated = discover_documents(NotionConfig(api_key="secret", pages=[root]))

    assert references == [root]
    assert parents == {}
    assert not truncated
    client.databases.retrieve.assert_not_called()
    client.data_sources.query.assert_not_called()


@patch("nao_core.commands.sync.providers.notion.provider.create_client")
def test_discover_documents_expands_database_rows_only_for_tree_roots(mock_create_client):
    root, nested_database = ("a" * 32, "b" * 32)
    client = mock_create_client.return_value

    def retrieve_page(page_id):
        if page_id == nested_database:
            raise api_error(APIErrorCode.ValidationError, 400)
        return {"id": page_id, "properties": {}}

    client.pages.retrieve.side_effect = retrieve_page
    client.blocks.children.list.return_value = {
        "results": [{"id": nested_database, "type": "child_page", "has_children": True}],
        "has_more": False,
    }

    references, parents, truncated = discover_documents(NotionConfig(api_key="secret", pages=[root]))

    assert references == [root, nested_database]
    assert parents == {nested_database: root}
    assert not truncated
    client.databases.retrieve.assert_not_called()
    client.data_sources.query.assert_not_called()


def test_retrieve_page_reports_a_database_as_not_a_page():
    client = MagicMock()
    client.pages.retrieve.side_effect = api_error(APIErrorCode.ValidationError, 400)

    assert retrieve_page(client, "some-id") is None


def test_expected_database_probe_warning_is_hidden(caplog):
    logger = logging.getLogger("notion_client")

    with caplog.at_level(logging.WARNING, logger="notion_client"):
        logger.warning("Provided ID some-id is a database, not a page")
        logger.warning("Notion request was rate limited")

    assert caplog.messages == ["Notion request was rate limited"]


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


@patch("notion2md.exporter.block.StringExporter.get_blocks")
def test_export_page_keeps_paragraphs_with_null_icons(mock_get_blocks):
    mock_get_blocks.return_value = [
        {
            "type": "paragraph",
            "paragraph": {
                "icon": None,
                "rich_text": [
                    {
                        "type": "text",
                        "plain_text": "Visible text",
                        "href": None,
                        "annotations": {
                            "bold": False,
                            "italic": False,
                            "strikethrough": False,
                            "underline": False,
                            "code": False,
                            "color": "default",
                        },
                    }
                ],
            },
            "has_children": False,
        }
    ]

    assert export_page_as_markdown("page-id", "secret") == "Visible text\n\n"


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


def test_write_documents_mirrors_nested_page_hierarchy(tmp_path: Path):
    root, child, grandchild = ("a" * 32, "b" * 32, "c" * 32)
    documents = [
        (root, "Root", "root"),
        (child, "Child", "child"),
        (grandchild, "Grandchild", "grandchild"),
    ]

    written, _, failed = write_documents(
        documents,
        tmp_path,
        {child: root, grandchild: child},
    )

    assert written == {
        "root-aaaaaaaa.md",
        "root-aaaaaaaa/child-bbbbbbbb.md",
        "root-aaaaaaaa/child-bbbbbbbb/grandchild-cccccccc.md",
    }
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

    result = provider.sync([NotionConfig(api_key="secret", pages=["page-a"], max_depth=0)], tmp_path)

    assert result.items_synced == 1


@patch("nao_core.commands.sync.providers.notion.provider.get_content_as_markdown")
def test_sync_survives_an_error_that_looks_like_console_markup(mock_get_page, tmp_path: Path):
    provider = NotionSyncProvider()
    mock_get_page.side_effect = RuntimeError("boom [/done]")

    result = provider.sync([NotionConfig(api_key="secret", pages=["page-a"], max_depth=0)], tmp_path)

    assert result.items_synced == 0
    assert result.error == "Failed to sync 1 Notion page"


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

    result = provider.sync([NotionConfig(api_key="secret", pages=["page-a"], max_depth=0)], tmp_path)

    assert previously_synced.read_text() == "# Page A\n\n| Name | Definition |"
    assert result.items_synced == 0
    assert result.details is not None
    assert result.details["removed"] == 0


def test_render_document_keeps_the_body_after_the_frontmatter():
    document = render_document("Title", "abc", "# Heading\n\ntext")

    assert document.startswith("---\n")
    assert document.endswith("# Heading\n\ntext\n")
