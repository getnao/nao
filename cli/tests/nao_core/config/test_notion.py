"""Tests for extract_page_id and NOTION_PAGE_ID_PATTERN."""

import pytest

from nao_core.config.notion import extract_page_id


class TestExtractPageId:
    def test_raw_32_char_hex_id(self):
        assert extract_page_id("2bfc7a70bc0680978900d1e85ece83a0") == "2bfc7a70bc0680978900d1e85ece83a0"

    def test_notion_url_with_workspace(self):
        url = "https://www.notion.so/naolabs/Conversational-analytics-2bfc7a70bc0680978900d1e85ece83a0"
        assert extract_page_id(url) == "2bfc7a70bc0680978900d1e85ece83a0"

    def test_notion_url_without_workspace(self):
        url = "https://www.notion.so/2bfc7a70bc0680978900d1e85ece83a0"
        assert extract_page_id(url) == "2bfc7a70bc0680978900d1e85ece83a0"

    def test_notion_url_with_query_params(self):
        url = "https://www.notion.so/Page-2bfc7a70bc0680978900d1e85ece83a0?v=abc123"
        assert extract_page_id(url) == "2bfc7a70bc0680978900d1e85ece83a0"

    def test_notion_url_with_hash(self):
        url = "https://www.notion.so/Page-2bfc7a70bc0680978900d1e85ece83a0#section"
        assert extract_page_id(url) == "2bfc7a70bc0680978900d1e85ece83a0"

    def test_whitespace_trimmed(self):
        assert extract_page_id("  2bfc7a70bc0680978900d1e85ece83a0  ") == "2bfc7a70bc0680978900d1e85ece83a0"

    def test_invalid_short_hex(self):
        with pytest.raises(ValueError, match="Could not extract"):
            extract_page_id("abc123")

    def test_invalid_non_hex(self):
        with pytest.raises(ValueError, match="Could not extract"):
            extract_page_id("not-a-valid-notion-page-id-at-all")

    def test_empty_string(self):
        with pytest.raises(ValueError, match="Could not extract"):
            extract_page_id("")

    def test_url_with_dashes_in_page_name(self):
        url = "https://www.notion.so/My-Great-Page-Title-2bfc7a70bc0680978900d1e85ece83a0"
        assert extract_page_id(url) == "2bfc7a70bc0680978900d1e85ece83a0"

    def test_backward_compat_with_provider_import(self):
        """Verify the import redirect in provider.py still works."""
        from nao_core.commands.sync.providers.notion.provider import extract_page_id as provider_extract

        assert provider_extract("2bfc7a70bc0680978900d1e85ece83a0") == "2bfc7a70bc0680978900d1e85ece83a0"
