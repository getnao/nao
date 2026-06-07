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


def test_advanced_inference_parameters():
    """Advanced inference parameters should be properly set and serialized."""
    config = LLMConfig(
        provider=LLMProvider.OPENAI,
        api_key="sk-test",
        temperature=0.7,
        top_p=0.9,
        max_tokens=1000,
        extras={"custom_param": "custom_value"},
    )
    assert config.temperature == 0.7
    assert config.top_p == 0.9
    assert config.max_tokens == 1000
    assert config.extras == {"custom_param": "custom_value"}

    dumped = config.model_dump(exclude_none=True)
    assert dumped["temperature"] == 0.7
    assert dumped["top_p"] == 0.9
    assert dumped["max_tokens"] == 1000
    assert dumped["extras"] == {"custom_param": "custom_value"}


def test_advanced_inference_parameters_none_by_default():
    """Advanced inference parameters should be None by default and excluded when serialized."""
    config = LLMConfig(provider=LLMProvider.OPENAI, api_key="sk-test")
    assert config.temperature is None
    assert config.top_p is None
    assert config.max_tokens is None
    assert config.extras is None

    dumped = config.model_dump(exclude_none=True)
    assert "temperature" not in dumped
    assert "top_p" not in dumped
    assert "max_tokens" not in dumped
    assert "extras" not in dumped

