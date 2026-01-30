from enum import Enum

from pydantic import BaseModel, Field
from rich.console import Console
from rich.prompt import Prompt

from nao_core.config.exceptions import InitError

console = Console()


class LLMProvider(str, Enum):
    """Supported LLM providers."""

    OPENAI = "openai"
    ANTHROPIC = "anthropic"
    MISTRAL = "mistral"
    GEMINI = "gemini"


class LLMConfig(BaseModel):
    """LLM configuration."""

    provider: LLMProvider = Field(description="The LLM provider to use")
    api_key: str = Field(description="The API key to use")

    @classmethod
    def promptConfig(cls) -> "LLMConfig":
        """Interactively prompt the user for LLM configuration."""
        console.print("\n[bold cyan]LLM Configuration[/bold cyan]\n")

        provider_choices = [p.value for p in LLMProvider]
        llm_provider = Prompt.ask(
            "[bold]Select LLM provider[/bold]",
            choices=provider_choices,
            default=provider_choices[0],
        )

        api_key = Prompt.ask(
            f"[bold]Enter your {llm_provider.upper()} API key[/bold]",
            password=True,
        )

        if not api_key:
            raise InitError("API key cannot be empty.")

        return LLMConfig(
            provider=LLMProvider(llm_provider),
            api_key=api_key,
        )
