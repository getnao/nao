"""Test configuration module."""

from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

DEFAULT_TEST_MODELS = ["openai:gpt-4.1"]

ReasoningEffort = Literal["minimal", "low", "medium", "high", "max"]
HarnessName = Literal["codex", "claude-code"]


class ComparisonConfig(BaseModel):
    """Tolerances applied when comparing the agent result to the expected data."""

    rtol: float = Field(default=1e-5, ge=0, description="Relative tolerance used to compare numeric values")
    atol: float = Field(default=1e-8, ge=0, description="Absolute tolerance used to compare numeric values")
    decimals: int = Field(default=2, ge=0, description="Decimals kept when rounding float values before comparing")


class TestModelConfig(BaseModel):
    """A model of `test.models` run once per reasoning effort listed, or at all the efforts it supports."""

    __test__ = False
    model_config = ConfigDict(extra="forbid")

    model: str = Field(description="The model, in the format 'provider:model_id'")
    reasoning_efforts: Annotated[list[ReasoningEffort], Field(min_length=1)] | Literal["all"] | None = Field(
        default=None,
        description="The reasoning efforts to run the model at, or 'all' of the ones it supports",
    )

    @field_validator("model")
    @classmethod
    def validate_model(cls, model: str) -> str:
        return validate_model_name(model)


class TestHarnessConfig(BaseModel):
    """A local headless agent CLI that runs each test through nao's context-layer MCP endpoint."""

    __test__ = False
    model_config = ConfigDict(extra="forbid")

    name: HarnessName
    model: str | None = Field(default=None, description="Optional model override passed to the harness")
    reasoning_effort: str | None = Field(
        default=None, description="Optional reasoning-effort override passed to the harness"
    )
    timeout_seconds: int = Field(default=600, ge=1, description="Maximum time for each harness invocation")


class TestConfig(BaseModel):
    """Defaults for `nao test`, each one overridable by the matching command line flag."""

    __test__ = False

    models: list[str | TestModelConfig] = Field(
        default_factory=lambda: list(DEFAULT_TEST_MODELS),
        description=(
            "The models to run the tests against, in the format 'provider:model_id', "
            "or as {model, reasoning_efforts} to run a model at several reasoning efforts"
        ),
    )
    harness: TestHarnessConfig | None = Field(
        default=None,
        description="Headless agent CLI used in context-layer mode instead of nao's built-in agent",
    )
    threads: int = Field(default=1, ge=1, description="Number of test runs to execute in parallel")
    k: int = Field(
        default=1,
        ge=1,
        description="Number of times to run each test case, used to compute pass@k and pass^k",
    )
    comparison: ComparisonConfig = Field(
        default_factory=ComparisonConfig, description="Tolerances used when comparing results to the expected data"
    )

    @field_validator("models")
    @classmethod
    def validate_models(cls, models: list[str | TestModelConfig]) -> list[str | TestModelConfig]:
        for model in models:
            if isinstance(model, str):
                validate_model_name(model)
        return models

    @field_validator("harness", mode="before")
    @classmethod
    def expand_harness_name(cls, harness: object) -> object:
        """Allow the concise `harness: codex` form as well as the full mapping."""
        return {"name": harness} if isinstance(harness, str) else harness


def validate_model_name(model: str) -> str:
    provider, _, model_id = model.partition(":")
    if not provider or not model_id:
        raise ValueError(f"invalid model '{model}', expected the format 'provider:model_id'")
    return model
