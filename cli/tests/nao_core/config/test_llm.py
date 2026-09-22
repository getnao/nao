"""Unit tests for LLM configuration."""

from unittest.mock import patch

import pytest

from nao_core.config.llm import (
    DEFAULT_ANNOTATION_MODELS,
    PROVIDER_AUTH,
    BudgetConfig,
    BudgetPeriod,
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


@pytest.mark.parametrize("provider", [LLMProvider.QWEN, LLMProvider.MINIMAX, LLMProvider.MOONSHOT])
def test_openai_compatible_providers_are_fully_declared(provider: LLMProvider):
    """Every provider needs auth, a default endpoint and an annotation model to be usable."""
    auth = PROVIDER_AUTH[provider]

    assert auth.api_key == "required"
    assert auth.default_base_url
    assert DEFAULT_ANNOTATION_MODELS[provider]

    with pytest.raises(ValueError, match="api_key is required"):
        ProviderConfig(provider=provider, api_key=None)


def test_openai_compatible_needs_an_endpoint_but_no_key():
    """The generic provider has no vendor endpoint to fall back on, and may need no authentication."""
    with pytest.raises(ValueError, match="base_url is required"):
        ProviderConfig(provider=LLMProvider.OPENAI_COMPATIBLE, api_key="sk-test")

    provider = ProviderConfig(provider=LLMProvider.OPENAI_COMPATIBLE, base_url="http://localhost:8000/v1")
    assert provider.requires_api_key is False


@pytest.mark.parametrize("spelling", ["openaiCompatible", "openai-compatible", "openai_compatible"])
def test_openai_compatible_accepts_every_spelling(spelling: str):
    assert parse_provider(spelling) == LLMProvider.OPENAI_COMPATIBLE

    provider = ProviderConfig.model_validate({"provider": spelling, "base_url": "http://localhost:8000/v1"})
    assert provider.provider == LLMProvider.OPENAI_COMPATIBLE


def test_named_endpoint_keeps_its_name_in_the_provider_field():
    """A project addresses several endpoints of the same kind through `openaiCompatible/<name>`."""
    provider = ProviderConfig.model_validate(
        {"provider": "openai-compatible/My vLLM", "base_url": "http://localhost:8000/v1"}
    )

    assert provider.provider == LLMProvider.OPENAI_COMPATIBLE
    assert provider.name == "my-vllm"
    assert provider.model_dump(mode="json")["provider"] == "openaiCompatible/my-vllm"


def test_rejects_a_name_the_app_cannot_address():
    with pytest.raises(ValueError, match="is not a valid provider name"):
        ProviderConfig.model_validate({"provider": "openaiCompatible/...", "base_url": "http://localhost:8000/v1"})

    with pytest.raises(ValueError, match="can be named"):
        ProviderConfig.model_validate({"provider": "openai/mine", "api_key": "sk-test"})


def test_accepts_several_named_endpoints_of_the_same_kind():
    config = LLMConfig(
        providers=[
            ProviderConfig(provider=LLMProvider.OPENAI_COMPATIBLE, name="prod", base_url="http://prod:8000/v1"),
            ProviderConfig(provider=LLMProvider.OPENAI_COMPATIBLE, name="staging", base_url="http://stg:8000/v1"),
        ]
    )

    assert [provider.id for provider in config.providers] == ["openaiCompatible/prod", "openaiCompatible/staging"]

    with pytest.raises(ValueError, match="configured more than once"):
        LLMConfig(
            providers=[
                ProviderConfig(provider=LLMProvider.OPENAI_COMPATIBLE, name="prod", base_url="http://a:8000/v1"),
                ProviderConfig(provider=LLMProvider.OPENAI_COMPATIBLE, name="prod", base_url="http://b:8000/v1"),
            ]
        )


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


def test_budget_reads_limits_and_period():
    config = LLMConfig(
        providers=[
            ProviderConfig(
                provider=LLMProvider.OPENAI,
                api_key="sk-test",
                budget=BudgetConfig(limit=100, per_user_limit=20, period=BudgetPeriod.WEEK),
            )
        ]
    )

    budget = config.providers[0].budget
    assert budget is not None
    assert budget.limit == 100
    assert budget.per_user_limit == 20
    assert budget.period is BudgetPeriod.WEEK


def test_budget_period_defaults_to_month():
    budget = BudgetConfig(limit=50)
    assert budget.period is BudgetPeriod.MONTH


def test_budget_requires_a_positive_limit():
    with pytest.raises(ValueError, match="budget requires a limit or a per_user_limit"):
        BudgetConfig(period=BudgetPeriod.MONTH)


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


def test_costs_are_resolved_for_a_named_endpoint():
    """A test run priced against `openaiCompatible/prod` must find the prices declared under it."""
    config = LLMConfig(
        providers=[
            ProviderConfig(
                provider=LLMProvider.OPENAI_COMPATIBLE,
                name="prod",
                base_url="http://prod:8000/v1",
                models=[ModelConfig(id="llama-3", costs=ModelCosts(input_no_cache=1, output=3))],
            ),
            ProviderConfig(
                provider=LLMProvider.OPENAI_COMPATIBLE,
                name="staging",
                base_url="http://stg:8000/v1",
                models=[ModelConfig(id="llama-3", costs=ModelCosts(input_no_cache=5, output=9))],
            ),
        ]
    )

    priced = config.costs("openaiCompatible/prod", "llama-3")
    assert priced is not None
    assert priced.input_no_cache == 1
    assert priced.output == 3


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


def test_annotation_target_can_name_the_endpoint_a_model_comes_from():
    """Endpoints sharing a model id are told apart by `<provider id>:<model id>`."""
    config = LLMConfig(
        providers=[
            ProviderConfig(
                provider=LLMProvider.OPENAI_COMPATIBLE,
                name="prod",
                base_url="http://prod:8000/v1",
                models=[ModelConfig(id="llama-3")],
            ),
            ProviderConfig(
                provider=LLMProvider.OPENAI_COMPATIBLE,
                name="staging",
                base_url="http://stg:8000/v1",
                models=[ModelConfig(id="llama-3")],
            ),
        ],
        annotation_model="openaiCompatible/staging:llama-3",
    )

    target = config.annotation_target()
    assert target is not None
    provider_config, model_id = target
    assert provider_config.name == "staging"
    assert model_id == "llama-3"


def test_annotation_target_keeps_a_model_id_holding_a_colon():
    config = LLMConfig(
        providers=[
            ProviderConfig(
                provider=LLMProvider.OLLAMA,
                models=[ModelConfig(id="llama3.2:latest")],
            )
        ],
        annotation_model="llama3.2:latest",
    )

    target = config.annotation_target()
    assert target is not None
    _, model_id = target
    assert model_id == "llama3.2:latest"


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
    second_provider_choices = mock_select.call_args_list[1].kwargs["choices"]
    assert {choice.value for choice in second_provider_choices} == {
        provider.value for provider in LLMProvider if provider != LLMProvider.OPENAI
    }
