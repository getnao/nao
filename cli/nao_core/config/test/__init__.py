"""Test configuration module."""

from pydantic import BaseModel, Field, field_validator

DEFAULT_TEST_MODELS = ["openai:gpt-4.1"]


class ComparisonConfig(BaseModel):
    """Tolerances applied when comparing the agent result to the expected data."""

    rtol: float = Field(default=1e-5, ge=0, description="Relative tolerance used to compare numeric values")
    atol: float = Field(default=1e-8, ge=0, description="Absolute tolerance used to compare numeric values")
    decimals: int = Field(default=2, ge=0, description="Decimals kept when rounding float values before comparing")


class TestConfig(BaseModel):
    """Defaults for `nao test`, each one overridable by the matching command line flag."""

    __test__ = False

    models: list[str] = Field(
        default_factory=lambda: list(DEFAULT_TEST_MODELS),
        description="The models to run the tests against, in the format 'provider:model_id'",
    )
    threads: int = Field(default=1, ge=1, description="Number of test runs to execute in parallel")
    comparison: ComparisonConfig = Field(
        default_factory=ComparisonConfig, description="Tolerances used when comparing results to the expected data"
    )

    @field_validator("models")
    @classmethod
    def validate_models(cls, models: list[str]) -> list[str]:
        for model in models:
            provider, _, model_id = model.partition(":")
            if not provider or not model_id:
                raise ValueError(f"invalid model '{model}', expected the format 'provider:model_id'")
        return models
