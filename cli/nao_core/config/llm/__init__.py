import re
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Literal

import questionary
from pydantic import BaseModel, Field, field_serializer, model_validator

from nao_core.ui import UI, ask_confirm, ask_select, ask_text


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
    QWEN = "qwen"
    MINIMAX = "minimax"
    MOONSHOT = "moonshot"
    OPENAI_COMPATIBLE = "openaiCompatible"


@dataclass(frozen=True)
class ProviderAuthConfig:
    env_var: str
    api_key: Literal["required", "optional", "none"]
    base_url_env_var: str | None = None
    alternative_env_vars: tuple[str, ...] = field(default_factory=tuple)
    hint: str | None = None
    default_base_url: str | None = None
    requires_base_url: bool = False


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
        env_var="OPENROUTER_API_KEY",
        api_key="required",
        base_url_env_var="OPENROUTER_BASE_URL",
        default_base_url="https://openrouter.ai/api/v1",
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
    LLMProvider.QWEN: ProviderAuthConfig(
        env_var="DASHSCOPE_API_KEY",
        api_key="required",
        base_url_env_var="DASHSCOPE_BASE_URL",
        default_base_url="https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
        hint="Model Studio keys are regional — set base_url to reach an endpoint other than Singapore",
    ),
    LLMProvider.MINIMAX: ProviderAuthConfig(
        env_var="MINIMAX_API_KEY",
        api_key="required",
        base_url_env_var="MINIMAX_BASE_URL",
        default_base_url="https://api.minimax.io/v1",
    ),
    LLMProvider.MOONSHOT: ProviderAuthConfig(
        env_var="MOONSHOT_API_KEY",
        api_key="required",
        base_url_env_var="MOONSHOT_BASE_URL",
        default_base_url="https://api.moonshot.ai/v1",
    ),
    LLMProvider.OPENAI_COMPATIBLE: ProviderAuthConfig(
        env_var="OPENAI_COMPATIBLE_API_KEY",
        api_key="optional",
        base_url_env_var="OPENAI_COMPATIBLE_BASE_URL",
        hint="Optional — only endpoints that ask for authentication need a key",
        requires_base_url=True,
    ),
}

"""Providers exposed through a plain OpenAI-compatible chat API rather than their own SDK."""
OPENAI_COMPATIBLE_PROVIDERS: frozenset[LLMProvider] = frozenset(
    {
        LLMProvider.OPENAI,
        LLMProvider.OPENROUTER,
        LLMProvider.QWEN,
        LLMProvider.MINIMAX,
        LLMProvider.MOONSHOT,
        LLMProvider.OPENAI_COMPATIBLE,
    }
)

"""OpenAI-compatible providers that answer `GET /v1/models` with a 404 instead of a model list."""
PROVIDERS_WITHOUT_MODEL_LIST: frozenset[LLMProvider] = frozenset({LLMProvider.QWEN, LLMProvider.MINIMAX})


DEFAULT_ANNOTATION_MODELS: dict[LLMProvider, str] = {
    LLMProvider.OPENAI: "gpt-4.1-mini",
    LLMProvider.ANTHROPIC: "claude-3-5-sonnet-latest",
    LLMProvider.MISTRAL: "mistral-small-latest",
    LLMProvider.GEMINI: "gemini-2.0-flash",
    LLMProvider.OPENROUTER: "openai/gpt-4.1-mini",
    LLMProvider.OLLAMA: "llama3.2",
    LLMProvider.BEDROCK: "anthropic.claude-3-5-sonnet-20241022-v2:0",
    LLMProvider.VERTEX: "gemini-2.5-flash",
    LLMProvider.QWEN: "qwen3.7-flash",
    LLMProvider.MINIMAX: "MiniMax-M2.7",
    LLMProvider.MOONSHOT: "kimi-k2.5",
}

"""Spellings accepted in config on top of the provider names nao uses internally."""
PROVIDER_ALIASES: dict[str, LLMProvider] = {
    "google": LLMProvider.GEMINI,
    "openai-compatible": LLMProvider.OPENAI_COMPATIBLE,
    "openai_compatible": LLMProvider.OPENAI_COMPATIBLE,
    "openaicompatible": LLMProvider.OPENAI_COMPATIBLE,
}


"""The only provider a project can declare several times, each instance under a name of its own."""
NAMED_PROVIDER = LLMProvider.OPENAI_COMPATIBLE
PROVIDER_NAME_PATTERN = re.compile(r"^[a-z0-9][a-z0-9-]*$")


def parse_provider(name: str) -> LLMProvider | None:
    """Resolve a provider name, accepting the aliases used by the chat backend."""
    if name in PROVIDER_ALIASES:
        return PROVIDER_ALIASES[name]
    try:
        return LLMProvider(name)
    except ValueError:
        return None


def parse_provider_id(provider_id: str) -> tuple[LLMProvider, str | None] | None:
    """Split how a provider is addressed, e.g. `openaiCompatible/my-vllm`, into its kind and name."""
    kind, _, name = provider_id.partition("/")
    provider = parse_provider(kind)
    if provider is None:
        return None
    return provider, name or None


def normalize_provider_name(value: str) -> str | None:
    """Turn what a user typed into a provider name, or None when nothing usable is left of it."""
    name = re.sub(r"^-+|-+$", "", re.sub(r"[^a-z0-9]+", "-", value.strip().lower()))
    return name if PROVIDER_NAME_PATTERN.match(name) else None


def ask_provider_name() -> str:
    """Ask for an endpoint name until one survives normalization, rather than dropping the answer."""
    while True:
        answer = ask_text("Name this endpoint (e.g. my-vllm):", required_field=True) or ""
        name = normalize_provider_name(answer)
        if name:
            return name
        UI.error(f"'{answer}' leaves no usable name: use lowercase letters, digits and dashes")


class ModelCosts(BaseModel):
    """Model price in US dollars per million tokens."""

    input_no_cache: float | None = Field(default=None, ge=0, description="Price of an uncached input token")
    input_cache_read: float | None = Field(default=None, ge=0, description="Price of an input token read from cache")
    input_cache_write: float | None = Field(default=None, ge=0, description="Price of an input token written to cache")
    output: float | None = Field(default=None, ge=0, description="Price of an output token")


class BudgetPeriod(str, Enum):
    """How often a provider's spend limit resets."""

    DAY = "day"
    WEEK = "week"
    MONTH = "month"


class BudgetConfig(BaseModel):
    """A spend limit for a provider, enforced by the chat app and shown in its budgets page."""

    limit: float | None = Field(default=None, ge=0, description="Project-wide spend limit in US dollars for the period")
    per_user_limit: float | None = Field(
        default=None, ge=0, description="Spend limit in US dollars per user for the period"
    )
    period: BudgetPeriod = Field(default=BudgetPeriod.MONTH, description="How often the limit resets")

    @model_validator(mode="after")
    def validate_limits(self) -> "BudgetConfig":
        if not self.limit and not self.per_user_limit:
            raise ValueError("budget requires a limit or a per_user_limit")
        return self


class LLMConfigMeta(BaseModel):
    costs: ModelCosts


class ModelConfig(BaseModel):
    """A model exposed to the agent by its provider."""

    id: str = Field(min_length=1, description="The model identifier used by the provider")
    name: str | None = Field(default=None, description="Display name shown in the model picker")
    default: bool = Field(default=False, description="Preselect this model for new chats")
    costs: ModelCosts | None = Field(default=None, description="Price in US dollars per million tokens")
    settings: dict[str, Any] | None = Field(
        default=None, description="Inference parameters for this model, e.g. temperature or reasoning_effort"
    )


class ProviderConfig(BaseModel):
    """Credentials and models for a single LLM provider."""

    provider: LLMProvider = Field(description="The LLM provider to use")
    name: str | None = Field(
        default=None,
        exclude=True,
        description="Name of this endpoint, written as `openaiCompatible/<name>` in the provider field",
    )
    api_key: str | None = Field(default=None, description="The API key to use")
    base_url: str | None = Field(default=None, description="Optional custom base URL for the provider API")
    access_key: str | None = Field(default=None, description="AWS access key (only for Bedrock)")
    secret_key: str | None = Field(default=None, description="AWS secret key (only for Bedrock)")
    aws_region: str | None = Field(default=None, description="AWS region (only for Bedrock)")
    aws_profile: str | None = Field(
        default=None, description="AWS CLI profile name (only for Bedrock, e.g. SSO profile)"
    )
    gcp_project: str | None = Field(default=None, description="GCP project ID (only for Vertex)")
    gcp_location: str | None = Field(default=None, description="GCP location (only for Vertex)")
    service_account_json: str | None = Field(default=None, description="Service account JSON (only for Vertex)")
    key_file: str | None = Field(default=None, description="Path to service account key file (only for Vertex)")
    models: list[ModelConfig] = Field(
        default_factory=list, description="The models to expose for this provider, in display order"
    )
    budget: BudgetConfig | None = Field(
        default=None, description="Spend limit for this provider, enforced by the chat app"
    )

    @property
    def id(self) -> str:
        """How the provider is addressed everywhere, e.g. `openaiCompatible/my-vllm`."""
        return f"{self.provider.value}/{self.name}" if self.name else self.provider.value

    @property
    def requires_api_key(self) -> bool:
        return PROVIDER_AUTH[self.provider].api_key == "required"

    @property
    def default_model(self) -> ModelConfig | None:
        """The model to preselect for new chats."""
        for model in self.models:
            if model.default:
                return model
        return self.models[0] if self.models else None

    def model(self, model_id: str) -> ModelConfig | None:
        for model in self.models:
            if model.id == model_id:
                return model
        return None

    @field_serializer("provider")
    def serialize_provider(self, provider: LLMProvider) -> str:
        return self.id

    @model_validator(mode="before")
    @classmethod
    def normalize_provider_alias(cls, data: Any) -> Any:
        """Accept `openai-compatible/my-vllm`, splitting the name off the provider it instantiates."""
        if not isinstance(data, dict):
            return data

        provider = data.get("provider")
        name = data.get("name")
        if isinstance(provider, str):
            kind, _, instance = provider.partition("/")
            provider = PROVIDER_ALIASES.get(kind, kind)
            name = instance or name

        normalized = {"provider": provider} if provider else {}
        if name:
            normalized["name"] = normalize_provider_name(name) or name
        return {**data, **normalized}

    @model_validator(mode="after")
    def validate_provider(self) -> "ProviderConfig":
        auth = PROVIDER_AUTH[self.provider]
        if auth.api_key == "required" and not self.api_key:
            raise ValueError(f"api_key is required for provider {self.id}")
        if auth.requires_base_url and not self.base_url:
            raise ValueError(f"base_url is required for provider {self.id}")
        if self.name and self.provider is not NAMED_PROVIDER:
            raise ValueError(f"only {NAMED_PROVIDER.value} providers can be named, got {self.id}")
        if self.name and not PROVIDER_NAME_PATTERN.match(self.name):
            raise ValueError(f"'{self.name}' is not a valid provider name: use lowercase letters, digits and dashes")

        seen: set[str] = set()
        for model in self.models:
            if model.id in seen:
                raise ValueError(f"duplicate model '{model.id}' for provider {self.id}")
            seen.add(model.id)

        defaults = [model.id for model in self.models if model.default]
        if len(defaults) > 1:
            raise ValueError(f"only one model can be the default for provider {self.id}, got {', '.join(defaults)}")
        return self

    @classmethod
    def promptConfig(cls, *, excluded_providers: set[LLMProvider] | None = None) -> "ProviderConfig":
        """Interactively prompt the user for a single provider's credentials."""
        excluded_providers = excluded_providers or set()
        provider_choices = [
            questionary.Choice("OpenAI (GPT-4, GPT-3.5)", value="openai"),
            questionary.Choice("Anthropic (Claude)", value="anthropic"),
            questionary.Choice("Mistral", value="mistral"),
            questionary.Choice("Google Gemini", value="gemini"),
            questionary.Choice("OpenRouter (Kimi, DeepSeek, etc.)", value="openrouter"),
            questionary.Choice("Ollama", value="ollama"),
            questionary.Choice("AWS Bedrock (Claude, Nova, etc)", value="bedrock"),
            questionary.Choice("Google Vertex AI (Claude, Gemini)", value="vertex"),
            questionary.Choice("Qwen (Alibaba Cloud Model Studio)", value="qwen"),
            questionary.Choice("MiniMax", value="minimax"),
            questionary.Choice("Moonshot (Kimi)", value="moonshot"),
            questionary.Choice("Other OpenAI-compatible endpoint (vLLM, LiteLLM, ...)", value="openaiCompatible"),
        ]
        provider_choices = [
            choice for choice in provider_choices if LLMProvider(choice.value) not in excluded_providers
        ]

        llm_provider = ask_select("Select LLM provider:", choices=provider_choices)
        auth = PROVIDER_AUTH[LLMProvider(llm_provider)]
        name = None
        base_url = None
        api_key = None
        access_key = None
        secret_key = None
        aws_region = None
        gcp_project = None
        gcp_location = None
        service_account_json = None
        key_file = None

        aws_profile = None

        if LLMProvider(llm_provider) is NAMED_PROVIDER:
            name = ask_provider_name()
            base_url = ask_text(
                "Enter the base URL of the endpoint (e.g. http://localhost:8000/v1):", required_field=True
            )
            api_key = ask_text("Enter its API key (leave blank if it needs none):", password=True)
        elif auth.requires_base_url:
            base_url = ask_text("Enter the base URL of the endpoint:", required_field=True)
            api_key = ask_text("Enter its API key (leave blank if it needs none):", password=True)
        elif auth.api_key == "required":
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
            if bedrock_auth_mode == "env":
                aws_profile = ask_text(
                    "Enter AWS profile name (leave blank for default):",
                    password=False,
                    required_field=False,
                )
            elif bedrock_auth_mode == "keys":
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

        return cls(
            provider=LLMProvider(llm_provider),
            name=name,
            api_key=api_key or None,
            base_url=base_url or None,
            access_key=access_key,
            secret_key=secret_key,
            aws_region=aws_region or None,
            aws_profile=aws_profile or None,
            gcp_project=gcp_project or None,
            gcp_location=gcp_location or None,
            service_account_json=service_account_json or None,
            key_file=key_file or None,
        )


class LLMConfig(BaseModel):
    """LLM configuration: one or more providers, each exposing one or more models."""

    providers: list[ProviderConfig] = Field(default_factory=list, description="The LLM providers to use")
    annotation_model: str | None = Field(
        default=None,
        description="Model to use for ai_summary generation via prompt(...) in Jinja templates",
    )
    meta: LLMConfigMeta | None = Field(
        default=None, description="Deprecated: declare costs on the matching model instead"
    )

    @property
    def primary(self) -> ProviderConfig | None:
        """The provider backing single-provider behaviours such as annotation."""
        return self.providers[0] if self.providers else None

    def provider_config(self, provider: LLMProvider | str) -> ProviderConfig | None:
        """Find a provider by how it is addressed, e.g. `anthropic` or `openaiCompatible/my-vllm`."""
        parsed = parse_provider_id(provider.value if isinstance(provider, LLMProvider) else provider)
        if parsed is None:
            return None
        kind, name = parsed
        for candidate in self.providers:
            if candidate.provider == kind and candidate.name == name:
                return candidate
        return None

    def costs(self, provider: LLMProvider | str, model_id: str) -> ModelCosts | None:
        """Resolve the price of a model, falling back to the deprecated top-level meta.costs."""
        provider_config = self.provider_config(provider)
        model = provider_config.model(model_id) if provider_config else None
        if model and model.costs:
            return model.costs
        return self.meta.costs if self.meta else None

    def annotation_target(self) -> tuple[ProviderConfig, str] | None:
        """Resolve the provider and model used by the prompt(...) template helper."""
        target = self.annotation_model
        if target:
            owner, model_id = self._annotation_owner(target)
            owner = owner or next((p for p in self.providers if p.model(model_id)), None)
            if owner:
                return owner, model_id

        primary = self.primary
        if not primary:
            return None
        return primary, target or DEFAULT_ANNOTATION_MODELS.get(primary.provider, "")

    def _annotation_owner(self, target: str) -> tuple[ProviderConfig | None, str]:
        """Read `openaiCompatible/my-vllm:llama-3`, which tells apart endpoints sharing a model id."""
        provider_id, separator, model_id = target.partition(":")
        if not separator:
            return None, target
        owner = self.provider_config(provider_id)
        return (owner, model_id) if owner else (None, target)

    @staticmethod
    def uses_legacy_shape(data: Any) -> bool:
        """Whether an `llm` block still declares a single inline provider."""
        return isinstance(data, dict) and "provider" in data and "providers" not in data

    @model_validator(mode="before")
    @classmethod
    def upgrade_legacy_shape(cls, data: Any) -> Any:
        """Accept the pre-multi-provider shape by nesting it into a single provider entry."""
        if not cls.uses_legacy_shape(data):
            return data

        provider_keys = set(ProviderConfig.model_fields) - {"models"}
        provider = {key: value for key, value in data.items() if key in provider_keys}
        rest = {key: value for key, value in data.items() if key not in provider_keys}
        return {**rest, "providers": [provider]}

    @model_validator(mode="after")
    def validate_providers(self) -> "LLMConfig":
        if not self.providers:
            raise ValueError("llm requires at least one entry under `providers`")

        seen: set[str] = set()
        for provider_config in self.providers:
            if provider_config.id in seen:
                raise ValueError(f"provider {provider_config.id} is configured more than once")
            seen.add(provider_config.id)

        if not self.annotation_model:
            primary = self.primary
            assert primary is not None
            self.annotation_model = DEFAULT_ANNOTATION_MODELS.get(primary.provider)
        return self

    @classmethod
    def promptConfig(cls, *, prompt_annotation_model: bool = True) -> "LLMConfig":
        """Interactively prompt the user for LLM configuration."""
        providers = [ProviderConfig.promptConfig()]
        while ask_confirm("Add another LLM provider?", default=False):
            # The named provider stays on offer: each endpoint is added under a name of its own.
            configured_providers = {p.provider for p in providers if p.provider is not NAMED_PROVIDER}
            providers.append(ProviderConfig.promptConfig(excluded_providers=configured_providers))

        annotation_model: str | None = None
        if prompt_annotation_model:
            annotation_model = ask_text(
                "Model to use for ai_summary generation (prompt helper):",
                default=DEFAULT_ANNOTATION_MODELS.get(providers[0].provider, ""),
            )

        config = LLMConfig(providers=providers, annotation_model=annotation_model)

        # Keep annotation model out of config unless ai_summary is enabled.
        # The default is still applied when needed during runtime/validation.
        if not prompt_annotation_model:
            config.annotation_model = None

        return config
