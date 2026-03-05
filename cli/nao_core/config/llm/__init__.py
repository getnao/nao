from dataclasses import dataclass, field
from enum import Enum
from typing import Literal

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
    BEDROCK = "bedrock"


@dataclass(frozen=True)
class ProviderAuthConfig:
    env_var: str
    api_key: Literal["required", "optional", "none"]
    base_url_env_var: str | None = None
    alternative_env_vars: tuple[str, ...] = field(default_factory=tuple)
    hint: str | None = None


PROVIDER_AUTH: dict[LLMProvider, ProviderAuthConfig] = {
    LLMProvider.OPENAI: ProviderAuthConfig(
        env_var="OPENAI_API_KEY", api_key="required", base_url_env_var="OPENAI_BASE_URL"
    ),
    LLMProvider.ANTHROPIC: ProviderAuthConfig(
        env_var="ANTHROPIC_API_KEY", api_key="required", base_url_env_var="ANTHROPIC_BASE_URL"
    ),
    LLMProvider.MISTRAL: ProviderAuthConfig(
        env_var="MISTRAL_API_KEY", api_key="required", base_url_env_var="MISTRAL_BASE_URL"
    ),
    LLMProvider.GEMINI: ProviderAuthConfig(
        env_var="GEMINI_API_KEY", api_key="required", base_url_env_var="GEMINI_BASE_URL"
    ),
    LLMProvider.OPENROUTER: ProviderAuthConfig(
        env_var="OPENROUTER_API_KEY", api_key="required", base_url_env_var="OPENROUTER_BASE_URL"
    ),
    LLMProvider.OLLAMA: ProviderAuthConfig(
        env_var="OLLAMA_API_KEY", api_key="none", base_url_env_var="OLLAMA_BASE_URL"
    ),
    LLMProvider.BEDROCK: ProviderAuthConfig(
        env_var="AWS_BEARER_TOKEN_BEDROCK",
        api_key="optional",
        alternative_env_vars=("AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY"),
        hint="Optional — uses AWS credentials from environment if not provided",
    ),
}


class LLMConfig(BaseModel):
    """LLM configuration."""

    provider: LLMProvider = Field(description="The LLM provider to use")
    api_key: str | None = Field(default=None, description="The API key to use")
    base_url: str | None = Field(default=None, description="Optional custom base URL for the provider API")
    access_key: str | None = Field(default=None, description="AWS access key (only for Bedrock)")
    secret_key: str | None = Field(default=None, description="AWS secret key (only for Bedrock)")

    @property
    def requires_api_key(self) -> bool:
        return self.provider not in (LLMProvider.OLLAMA, LLMProvider.BEDROCK)

    def get_effective_api_key_for_env(self) -> str | None:
        """Return the API key value to export via environment variables."""
        if self.api_key:
            return self.api_key
        if self.requires_api_key:
            return None
        return f"{self.provider.value}_api_key"

    @model_validator(mode="after")
    def validate_api_key(self) -> "LLMConfig":
        auth = PROVIDER_AUTH[self.provider]
        if auth.api_key == "required" and not self.api_key:
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
            questionary.Choice("AWS Bedrock (Claude, Nova, etc)", value="bedrock"),
        ]

        llm_provider = ask_select("Select LLM provider:", choices=provider_choices)
        auth = PROVIDER_AUTH[LLMProvider(llm_provider)]
        api_key = None
        access_key = None
        secret_key = None

        if auth.api_key == "required":
            api_key = ask_text(f"Enter your {llm_provider.upper()} API key:", password=True, required_field=True)
        elif llm_provider == "bedrock":
            bedrock_auth_mode = ask_select(
                "Select AWS authentication mode:",
                choices=[
                    questionary.Choice("Environment credentials (IAM role, AWS profile, etc.)", value="env"),
                    questionary.Choice("Access key / Secret key", value="keys"),
                    questionary.Choice("Bearer token", value="bearer"),
                ],
            )
            if bedrock_auth_mode == "keys":
                access_key = ask_text("Enter AWS access key:", password=False, required_field=True)
                secret_key = ask_text("Enter AWS secret key:", password=True, required_field=True)
            elif bedrock_auth_mode == "bearer":
                api_key = ask_text("Enter AWS bearer token:", password=True, required_field=True)

        return LLMConfig(
            provider=LLMProvider(llm_provider),
            api_key=api_key,
            access_key=access_key,
            secret_key=secret_key,
        )
