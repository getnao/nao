"""Unit tests for LLM configuration."""

from unittest.mock import patch

import pytest

from nao_core.config.llm import DEFAULT_ANNOTATION_MODELS, LLMConfig, LLMProvider


def test_default_annotation_model_is_applied():
    """annotation_model should default based on provider."""
    config = LLMConfig(provider=LLMProvider.OPENAI, api_key="sk-test")
    assert config.annotation_model == DEFAULT_ANNOTATION_MODELS[LLMProvider.OPENAI]


def test_ollama_allows_missing_api_key():
    """ollama provider should not require an API key."""
    config = LLMConfig(provider=LLMProvider.OLLAMA, api_key=None)
    assert config.annotation_model == DEFAULT_ANNOTATION_MODELS[LLMProvider.OLLAMA]


def test_non_ollama_requires_api_key():
    """providers other than ollama should require API key."""
    with pytest.raises(ValueError, match="api_key is required"):
        LLMConfig(provider=LLMProvider.ANTHROPIC, api_key=None)


@patch("nao_core.config.llm.ask_text")
@patch("nao_core.config.llm.ask_select")
def test_prompt_config_skips_annotation_model_when_disabled(mock_select, mock_text):
    """promptConfig should not ask for annotation model when disabled."""
    mock_select.return_value = "openai"
    mock_text.return_value = "sk-test-key"

    config = LLMConfig.promptConfig(prompt_annotation_model=False)

    assert config.provider == LLMProvider.OPENAI
    assert config.api_key == "sk-test-key"
    assert config.annotation_model is None
    assert "annotation_model" not in config.model_dump(exclude_none=True)
    assert mock_text.call_count == 1


@patch("nao_core.config.llm.ask_text")
@patch("nao_core.config.llm.ask_select")
def test_prompt_config_prompts_annotation_model_when_enabled(mock_select, mock_text):
    """promptConfig should ask for annotation model when enabled."""
    mock_select.return_value = "openai"
    mock_text.side_effect = ["sk-test-key", "gpt-4.1"]

    config = LLMConfig.promptConfig(prompt_annotation_model=True)

    assert config.provider == LLMProvider.OPENAI
    assert config.api_key == "sk-test-key"
    assert config.annotation_model == "gpt-4.1"
    assert mock_text.call_count == 2
