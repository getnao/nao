from enum import Enum

from pydantic import BaseModel, Field


class LLMProvider(str, Enum):
    """Supported LLM providers."""

    OPENAI = "openai"


class LLMConfig(BaseModel):
    """LLM configuration."""

    provider: LLMProvider = Field(description="The LLM provider to use")
    api_key: str = Field(description="The API key to use")
