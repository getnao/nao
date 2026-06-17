"""Unit tests for the Notion sync provider."""

from pathlib import Path
from unittest.mock import patch

from nao_core.commands.sync.providers.notion.provider import NotionSyncProvider
from nao_core.config.notion import NotionConfig


@patch("nao_core.commands.sync.providers.notion.provider.get_page_as_markdown")
def test_sync_pages_with_threads(mock_get_page, tmp_path: Path):
    provider = NotionSyncProvider()
    config = NotionConfig(api_key="secret", pages=["page-a", "page-b"])

    def _get_page(page_url: str, _api_key: str) -> tuple[str, str]:
        title = "Page A" if page_url == "page-a" else "Page B"
        return title, f"# {title}"

    mock_get_page.side_effect = _get_page

    result = provider.sync([config], tmp_path, threads=2)

    assert result.items_synced == 2
    assert (tmp_path / "page-a.md").read_text() == "# Page A"
    assert (tmp_path / "page-b.md").read_text() == "# Page B"
    assert mock_get_page.call_count == 2
