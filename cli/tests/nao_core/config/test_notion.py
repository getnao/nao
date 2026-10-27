from unittest.mock import patch

from nao_core.config.notion import NotionConfig


@patch("nao_core.config.notion.ask_text")
def test_prompt_config_keeps_single_pages_non_recursive(mock_ask_text):
    page = "a" * 32
    mock_ask_text.side_effect = ["secret", page, ""]

    config = NotionConfig.promptConfig()

    assert config.pages == [page]
    assert config.page_trees == []
    assert config.max_depth == 3
    assert config.max_pages == 100


@patch("nao_core.config.notion.ask_text")
def test_prompt_config_asks_for_recursive_limits(mock_ask_text):
    root = "a" * 32
    mock_ask_text.side_effect = ["secret", "", root, "2", "25"]

    config = NotionConfig.promptConfig()

    assert config.pages == []
    assert config.page_trees == [root]
    assert config.max_depth == 2
    assert config.max_pages == 25


@patch("nao_core.config.notion.UI.warn")
@patch("nao_core.config.notion.ask_text")
def test_prompt_config_retries_invalid_recursive_limits(mock_ask_text, mock_warn):
    root = "a" * 32
    mock_ask_text.side_effect = ["secret", "", root, "-1", "2", "0", "25"]

    config = NotionConfig.promptConfig()

    assert config.max_depth == 2
    assert config.max_pages == 25
    assert mock_warn.call_count == 2
