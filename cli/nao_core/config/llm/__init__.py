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
    VERTEX = "vertex"


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
    LLMProvider.VERTEX: ProviderAuthConfig(
        env_var="VERTEX_GOOGLE_SERVICE_ACCOUNT_JSON",
        api_key="none",
        alternative_env_vars=(
            "GOOGLE_VERTEX_PROJECT",
            "GOOGLE_VERTEX_LOCATION",
            "VERTEX_GOOGLE_APPLICATION_CREDENTIALS",
        ),
    ),
}


DEFAULT_ANNOTATION_MODELS: dict[LLMProvider, str] = {
    LLMProvider.OPENAI: "gpt-4.1-mini",
    LLMProvider.ANTHROPIC: "claude-3-5-sonnet-latest",
    LLMProvider.MISTRAL: "mistral-small-latest",
    LLMProvider.GEMINI: "gemini-2.0-flash",
    LLMProvider.OPENROUTER: "openai/gpt-4.1-mini",
    LLMProvider.OLLAMA: "llama3.2",
    LLMProvider.BEDROCK: "anthropic.claude-3-5-sonnet-20241022-v2:0",
    LLMProvider.VERTEX: "gemini-2.5-flash",
}


class LLMConfig(BaseModel):
    """LLM configuration."""

    provider: LLMProvider = Field(description="The LLM provider to use")
    api_key: str | None = Field(default=None, description="The API key to use")
    base_url: str | None = Field(default=None, description="Optional custom base URL for the provider API")
    access_key: str | None = Field(default=None, description="AWS access key (only for Bedrock)")
    secret_key: str | None = Field(default=None, description="AWS secret key (only for Bedrock)")
    aws_region: str | None = Field(default=None, description="AWS region (only for Bedrock)")
    gcp_project: str | None = Field(default=None, description="GCP project ID (only for Vertex)")
    gcp_location: str | None = Field(default=None, description="GCP location (only for Vertex)")
    service_account_json: str | None = Field(default=None, description="Service account JSON (only for Vertex)")
    key_file: str | None = Field(default=None, description="Path to service account key file (only for Vertex)")
    annotation_model: str | None = Field(
        default=None,
        description="Model to use for ai_summary generation via prompt(...) in Jinja templates",
    )

    @property
    def requires_api_key(self) -> bool:
        return self.provider not in (LLMProvider.OLLAMA, LLMProvider.BEDROCK, LLMProvider.VERTEX)

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

        if not self.annotation_model:
            default_annotation_model = DEFAULT_ANNOTATION_MODELS.get(self.provider)
            if default_annotation_model:
                self.annotation_model = default_annotation_model
        return self

    @classmethod
    def promptConfig(cls, *, prompt_annotation_model: bool = True) -> "LLMConfig":
        """Interactively prompt the user for LLM configuration."""
        provider_choices = [
            questionary.Choice("OpenAI (GPT-4, GPT-3.5)", value="openai"),
            questionary.Choice("Anthropic (Claude)", value="anthropic"),
            questionary.Choice("Mistral", value="mistral"),
            questionary.Choice("Google Gemini", value="gemini"),
            questionary.Choice("OpenRouter (Kimi, DeepSeek, etc.)", value="openrouter"),
            questionary.Choice("Ollama", value="ollama"),
            questionary.Choice("AWS Bedrock (Claude, Nova, etc)", value="bedrock"),
            questionary.Choice("Google Vertex AI (Claude, Gemini)", value="vertex"),
        ]

        llm_provider = ask_select("Select LLM provider:", choices=provider_choices)
        auth = PROVIDER_AUTH[LLMProvider(llm_provider)]
        api_key = None
        access_key = None
        secret_key = None
        aws_region = None
        gcp_project = None
        gcp_location = None
        service_account_json = None
        key_file = None

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
            aws_region = ask_text("Enter AWS region (e.g. us-east-1):", password=False, required_field=False)
        elif llm_provider == "vertex":
            gcp_project = ask_text("Enter GCP project ID:", password=False, required_field=True)
            gcp_location = ask_text("Enter GCP location (e.g. us-east5):", password=False, required_field=False)
            vertex_auth_mode = ask_select(
                "Select Vertex AI authentication mode:",
                choices=[
                    questionary.Choice("Application Default Credentials (gcloud auth)", value="adc"),
                    questionary.Choice("Service account JSON (paste inline)", value="json"),
                    questionary.Choice("Key file path", value="file"),
                ],
            )
            if vertex_auth_mode == "json":
                service_account_json = ask_text("Paste service account JSON:", password=True, required_field=True)
            elif vertex_auth_mode == "file":
                key_file = ask_text("Enter path to service account key file:", password=False, required_field=True)

        provider = LLMProvider(llm_provider)
        annotation_model: str | None = None
        if prompt_annotation_model:
            annotation_model = ask_text(
                "Model to use for ai_summary generation (prompt helper):",
                default=DEFAULT_ANNOTATION_MODELS[provider],
            )

        config = LLMConfig(
            provider=provider,
            api_key=api_key,
            access_key=access_key,
            secret_key=secret_key,
            aws_region=aws_region or None,
            gcp_project=gcp_project or None,
            gcp_location=gcp_location or None,
            service_account_json=service_account_json or None,
            key_file=key_file or None,
            annotation_model=annotation_model,
        )

        # Keep annotation model out of config unless ai_summary is enabled.
        # The default is still applied when needed during runtime/validation.
        if not prompt_annotation_model:
            config.annotation_model = None

        return config
