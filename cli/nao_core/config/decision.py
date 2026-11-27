"""Decision (System 1) model configuration module."""

from enum import Enum
from typing import Any

from pydantic import BaseModel, Field, model_validator


class DecisionProvider(str, Enum):
    """Supported decision model providers."""

    TYPESAFE = "typesafe"
    OPENAI = "openai"
    CLOUDFLARE = "cloudflare"
    OLLAMA = "ollama"
    SYSTEM_ONE = "systemOne"


PROVIDER_ALIASES = {
    "jev": DecisionProvider.TYPESAFE.value,
    "clef": DecisionProvider.CLOUDFLARE.value,
    "systemone": DecisionProvider.SYSTEM_ONE.value,
}


def normalize_provider(name: str) -> str:
    """Accept the spellings the chat backend accepts: `system-one`, `system_one` and `systemOne` are the same."""
    key = name.strip().lower().replace("-", "").replace("_", "")
    return PROVIDER_ALIASES.get(key, key)


class DecisionProviderConfig(BaseModel):
    """Credentials for a single decision model provider."""

    provider: DecisionProvider = Field(description="The decision model provider to use")
    api_key: str | None = Field(
        default=None,
        description="The API key to use. Left out, `openai` and `ollama` use the key of the same `llm` provider",
    )
    base_url: str | None = Field(
        default=None, description="Base URL of the API, required for a `systemOne` compatible endpoint"
    )
    account_id: str | None = Field(default=None, description="Cloudflare account ID (only for Cloudflare)")

    @model_validator(mode="before")
    @classmethod
    def normalize_provider_alias(cls, data: Any) -> Any:
        if isinstance(data, dict) and isinstance(data.get("provider"), str):
            return {**data, "provider": normalize_provider(data["provider"])}
        return data

    @model_validator(mode="after")
    def validate_provider(self) -> "DecisionProviderConfig":
        if self.provider is DecisionProvider.SYSTEM_ONE and not self.base_url:
            raise ValueError("base_url is required for provider systemOne")
        return self


class DecisionConfig(BaseModel):
    """Models that answer yes/no, pick-one and score questions, read by the chat app.

    Providers edited in the app (Settings > Project > Agent > Decision models) take precedence over this block.
    """

    providers: list[DecisionProviderConfig] = Field(
        default_factory=list, description="The decision model providers and their credentials"
    )
    model: str | None = Field(
        default=None, description="The model decisions run on, written `provider/model-id`, e.g. 'typesafe/jev-latest'"
    )

    @model_validator(mode="after")
    def validate_decision(self) -> "DecisionConfig":
        declared = [provider.provider for provider in self.providers]
        duplicates = {provider.value for provider in declared if declared.count(provider) > 1}
        if duplicates:
            raise ValueError(f"decision providers are declared twice: {', '.join(sorted(duplicates))}")

        if self.model is not None:
            provider, _, model_id = self.model.partition("/")
            if not model_id or normalize_provider(provider) not in {p.value for p in DecisionProvider}:
                raise ValueError(f"decision model '{self.model}' must be written 'provider/model-id'")
        return self


__all__ = ["DecisionConfig", "DecisionProvider", "DecisionProviderConfig"]
