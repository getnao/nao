"""Unit tests for LLM configuration."""

from unittest.mock import patch

import pytest

from nao_core.config.llm import (
    DEFAULT_ANNOTATION_MODELS,
    LLMConfig,
    LLMProvider,
    ModelConfig,
    ModelCosts,
    ProviderConfig,
    parse_provider,
)


def test_default_annotation_model_is_applied():
    """annotation_model should default based on the primary provider."""
    config = LLMConfig(providers=[ProviderConfig(provider=LLMProvider.OPENAI, api_key="sk-test")])
    assert config.annotation_model == DEFAULT_ANNOTATION_MODELS[LLMProvider.OPENAI]


def test_ollama_allows_missing_api_key():
    """ollama provider should not require an API key."""
    config = LLMConfig(providers=[ProviderConfig(provider=LLMProvider.OLLAMA, api_key=None)])
    assert config.annotation_model == DEFAULT_ANNOTATION_MODELS[LLMProvider.OLLAMA]


def test_non_ollama_requires_api_key():
    """providers other than ollama should require API key."""
    with pytest.raises(ValueError, match="api_key is required"):
        ProviderConfig(provider=LLMProvider.ANTHROPIC, api_key=None)


def test_requires_at_least_one_provider():
    with pytest.raises(ValueError, match="at least one entry under `providers`"):
        LLMConfig(providers=[])


def test_rejects_duplicate_providers():
    with pytest.raises(ValueError, match="configured more than once"):
        LLMConfig(
            providers=[
                ProviderConfig(provider=LLMProvider.OPENAI, api_key="a"),
                ProviderConfig(provider=LLMProvider.OPENAI, api_key="b"),
            ]
        )


def test_rejects_duplicate_models():
    with pytest.raises(ValueError, match="duplicate model 'gpt-4.1'"):
        ProviderConfig(
            provider=LLMProvider.OPENAI,
            api_key="sk-test",
            models=[ModelConfig(id="gpt-4.1"), ModelConfig(id="gpt-4.1")],
        )


def test_rejects_several_default_models():
    with pytest.raises(ValueError, match="only one model can be the default"):
        ProviderConfig(
            provider=LLMProvider.OPENAI,
            api_key="sk-test",
            models=[ModelConfig(id="gpt-4.1", default=True), ModelConfig(id="gpt-5", default=True)],
        )


def test_default_model_prefers_the_flagged_one():
    provider = ProviderConfig(
        provider=LLMProvider.OPENAI,
        api_key="sk-test",
        models=[ModelConfig(id="gpt-4.1"), ModelConfig(id="gpt-5", default=True)],
    )
    assert provider.default_model is not None
    assert provider.default_model.id == "gpt-5"


def test_default_model_falls_back_to_the_first_one():
    provider = ProviderConfig(
        provider=LLMProvider.OPENAI,
        api_key="sk-test",
        models=[ModelConfig(id="gpt-4.1"), ModelConfig(id="gpt-5")],
    )
    assert provider.default_model is not None
    assert provider.default_model.id == "gpt-4.1"


def test_costs_are_resolved_per_model():
    config = LLMConfig(
        providers=[
            ProviderConfig(
                provider=LLMProvider.OPENAI,
                api_key="sk-test",
                models=[
                    ModelConfig(id="gpt-4.1", costs=ModelCosts(input_no_cache=2, output=8)),
                    ModelConfig(id="gpt-5"),
                ],
            )
        ]
    )

    priced = config.costs(LLMProvider.OPENAI, "gpt-4.1")
    assert priced is not None
    assert priced.input_no_cache == 2
    assert priced.output == 8
    assert config.costs(LLMProvider.OPENAI, "gpt-5") is None
    assert config.costs(LLMProvider.ANTHROPIC, "gpt-4.1") is None


def test_costs_fall_back_to_deprecated_meta():
    config = LLMConfig.model_validate(
        {
            "providers": [{"provider": "openai", "api_key": "sk-test"}],
            "meta": {"costs": {"output": 42}},
        }
    )
    priced = config.costs(LLMProvider.OPENAI, "any-model")
    assert priced is not None
    assert priced.output == 42


def test_annotation_target_prefers_the_provider_owning_the_model():
    config = LLMConfig(
        providers=[
            ProviderConfig(provider=LLMProvider.OPENAI, api_key="sk-test"),
            ProviderConfig(
                provider=LLMProvider.ANTHROPIC,
                api_key="sk-ant",
                models=[ModelConfig(id="claude-haiku-4-5")],
            ),
        ],
        annotation_model="claude-haiku-4-5",
    )

    target = config.annotation_target()
    assert target is not None
    provider_config, model_id = target
    assert provider_config.provider == LLMProvider.ANTHROPIC
    assert model_id == "claude-haiku-4-5"


def test_annotation_target_falls_back_to_the_primary_provider():
    config = LLMConfig(
        providers=[
            ProviderConfig(provider=LLMProvider.OPENAI, api_key="sk-test"),
            ProviderConfig(provider=LLMProvider.ANTHROPIC, api_key="sk-ant"),
        ]
    )

    target = config.annotation_target()
    assert target is not None
    provider_config, model_id = target
    assert provider_config.provider == LLMProvider.OPENAI
    assert model_id == DEFAULT_ANNOTATION_MODELS[LLMProvider.OPENAI]


def test_google_is_accepted_as_an_alias_for_gemini():
    config = LLMConfig.model_validate({"providers": [{"provider": "google", "api_key": "key"}]})
    assert config.providers[0].provider == LLMProvider.GEMINI
    assert parse_provider("google") == LLMProvider.GEMINI
    assert parse_provider("openai") == LLMProvider.OPENAI
    assert parse_provider("nonsense") is None


class TestLegacyShape:
    """The pre-multi-provider `llm` block must keep working."""

    def test_inline_provider_is_nested_under_providers(self):
        config = LLMConfig.model_validate(
            {
                "provider": "anthropic",
                "api_key": "sk-ant",
                "base_url": "http://localhost:4000",
                "annotation_model": "claude-3-5-haiku-latest",
            }
        )

        assert len(config.providers) == 1
        provider_config = config.providers[0]
        assert provider_config.provider == LLMProvider.ANTHROPIC
        assert provider_config.api_key == "sk-ant"
        assert provider_config.base_url == "http://localhost:4000"
        assert provider_config.models == []
        assert config.annotation_model == "claude-3-5-haiku-latest"

    def test_bedrock_credentials_are_preserved(self):
        config = LLMConfig.model_validate(
            {
                "provider": "bedrock",
                "access_key": "AKIA_TEST",
                "secret_key": "SECRET_TEST",
                "aws_region": "eu-west-1",
            }
        )

        provider_config = config.providers[0]
        assert provider_config.access_key == "AKIA_TEST"
        assert provider_config.secret_key == "SECRET_TEST"
        assert provider_config.aws_region == "eu-west-1"

    def test_detection_only_matches_the_legacy_shape(self):
        assert LLMConfig.uses_legacy_shape({"provider": "openai"})
        assert not LLMConfig.uses_legacy_shape({"providers": [{"provider": "openai"}]})
        assert not LLMConfig.uses_legacy_shape(None)


@patch("nao_core.config.llm.ask_confirm", return_value=False)
@patch("nao_core.config.llm.ask_text")
@patch("nao_core.config.llm.ask_select")
def test_prompt_config_skips_annotation_model_when_disabled(mock_select, mock_text, _mock_confirm):
    """promptConfig should not ask for annotation model when disabled."""
    mock_select.return_value = "openai"
    mock_text.return_value = "sk-test-key"

    config = LLMConfig.promptConfig(prompt_annotation_model=False)

    assert config.providers[0].provider == LLMProvider.OPENAI
    assert config.providers[0].api_key == "sk-test-key"
    assert config.annotation_model is None
    assert "annotation_model" not in config.model_dump(exclude_none=True)
    assert mock_text.call_count == 1


@patch("nao_core.config.llm.ask_confirm", return_value=False)
@patch("nao_core.config.llm.ask_text")
@patch("nao_core.config.llm.ask_select")
def test_prompt_config_prompts_annotation_model_when_enabled(mock_select, mock_text, _mock_confirm):
    """promptConfig should ask for annotation model when enabled."""
    mock_select.return_value = "openai"
    mock_text.side_effect = ["sk-test-key", "gpt-4.1"]

    config = LLMConfig.promptConfig(prompt_annotation_model=True)

    assert config.providers[0].provider == LLMProvider.OPENAI
    assert config.annotation_model == "gpt-4.1"
    assert mock_text.call_count == 2


@patch("nao_core.config.llm.ask_confirm", side_effect=[True, False])
@patch("nao_core.config.llm.ask_text")
@patch("nao_core.config.llm.ask_select")
def test_prompt_config_collects_several_providers(mock_select, mock_text, _mock_confirm):
    """promptConfig should keep asking until the user declines another provider."""
    mock_select.side_effect = ["openai", "anthropic"]
    mock_text.side_effect = ["sk-openai", "sk-anthropic"]

    config = LLMConfig.promptConfig(prompt_annotation_model=False)

    assert [p.provider for p in config.providers] == [LLMProvider.OPENAI, LLMProvider.ANTHROPIC]
