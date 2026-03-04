from enum import Enum

import questionary
from pydantic import BaseModel, Field, model_validator

from nao_core.ui import ask_select, ask_text


class LLMProvider(str, Enum):
    """Supported LLM providers."""

    OPENAI = "openai"
    ANTHROPIC = "anthropic"
    MISTRAL = "mistral"
    GEMINI = "gemini"
    OPENROUTER = "openrouter"
    OLLAMA = "ollama"


class LLMConfig(BaseModel):
    """LLM configuration."""

    provider: LLMProvider = Field(description="The LLM provider to use")
    api_key: str | None = Field(default=None, description="The API key to use")
    base_url: str | None = Field(default=None, description="Optional custom base URL for the provider API")

    @property
    def requires_api_key(self) -> bool:
        return self.provider != LLMProvider.OLLAMA

    def get_effective_api_key_for_env(self) -> str | None:
        """Return the API key value to export via environment variables."""
        if self.api_key:
            return self.api_key
        if self.requires_api_key:
            return None
        return f"{self.provider.value}_api_key"

    @model_validator(mode="after")
    def validate_api_key(self) -> "LLMConfig":
        if self.requires_api_key and not self.api_key:
            raise ValueError(f"api_key is required for provider {self.provider.value}")
        return self

    @classmethod
    def promptConfig(cls) -> "LLMConfig":
        """Interactively prompt the user for LLM configuration."""
        provider_choices = [
            questionary.Choice("OpenAI (GPT-4, GPT-3.5)", value="openai"),
            questionary.Choice("Anthropic (Claude)", value="anthropic"),
            questionary.Choice("Mistral", value="mistral"),
            questionary.Choice("Google Gemini", value="gemini"),
            questionary.Choice("OpenRouter (Kimi, DeepSeek, etc.)", value="openrouter"),
            questionary.Choice("Ollama", value="ollama"),
        ]

        llm_provider = ask_select("Select LLM provider:", choices=provider_choices)
        api_key = None
        if llm_provider != LLMProvider.OLLAMA:
            api_key = ask_text(f"Enter your {llm_provider.upper()} API key:", password=True, required_field=True)

        return LLMConfig(
            provider=LLMProvider(llm_provider),
            api_key=api_key,
        )
