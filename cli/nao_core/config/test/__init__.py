"""Test configuration module."""

from typing import Annotated, Literal, NamedTuple

from pydantic import BaseModel, ConfigDict, Field, field_validator

DEFAULT_TEST_MODELS = ["openai:gpt-4.1"]

ReasoningEffort = Literal["minimal", "low", "medium", "high", "max"]


class CronField(NamedTuple):
    lowest: int
    highest: int
    names: dict[str, int]


MONTH_NAMES = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"]
WEEKDAY_NAMES = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"]
CRON_FIELDS = [
    CronField(0, 59, {}),
    CronField(0, 23, {}),
    CronField(1, 31, {}),
    CronField(1, 12, {name: month for month, name in enumerate(MONTH_NAMES, start=1)}),
    CronField(0, 7, {name: weekday for weekday, name in enumerate(WEEKDAY_NAMES)}),
]


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


class TestScheduleConfig(BaseModel):
    """A schedule of `test.schedules`, on which the deployed app runs the tests against the production context."""

    __test__ = False
    model_config = ConfigDict(extra="forbid")

    cron: str = Field(description="When to run the tests, as a 5-field cron expression in the server timezone")
    tags: list[str] = Field(default_factory=list, description="Run only the tests with one of these tags")
    models: list[str | TestModelConfig] | None = Field(
        default=None, description="The models to run the tests against, `test.models` by default"
    )
    k: int | None = Field(default=None, ge=1, description="Number of times to run each test case, `test.k` by default")

    @field_validator("cron")
    @classmethod
    def validate_cron(cls, cron: str) -> str:
        return validate_schedule_cron(cron)

    @field_validator("models")
    @classmethod
    def validate_models(cls, models: list[str | TestModelConfig] | None) -> list[str | TestModelConfig] | None:
        for model in models or []:
            if isinstance(model, str):
                validate_model_name(model)
        return models


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
    threads: int = Field(default=1, ge=1, description="Number of test runs to execute in parallel")
    k: int = Field(
        default=1,
        ge=1,
        description="Number of times to run each test case, used to compute pass@k and pass^k",
    )
    comparison: ComparisonConfig = Field(
        default_factory=ComparisonConfig, description="Tolerances used when comparing results to the expected data"
    )
    schedules: list[TestScheduleConfig] = Field(
        default_factory=list,
        description="Schedules on which the deployed app runs the tests, ignored by `nao test`",
    )

    @field_validator("models")
    @classmethod
    def validate_models(cls, models: list[str | TestModelConfig]) -> list[str | TestModelConfig]:
        for model in models:
            if isinstance(model, str):
                validate_model_name(model)
        return models


def validate_schedule_cron(cron: str) -> str:
    """Rejects what the deployed app rejects: an invalid expression, or one that runs more than once an hour."""
    fields = cron.split()
    if len(fields) != len(CRON_FIELDS) or not all(
        is_valid_cron_part(part, field) for value, field in zip(fields, CRON_FIELDS) for part in value.split(",")
    ):
        raise ValueError(f"invalid cron '{cron}', expected 5 fields such as '0 6 * * *'")
    if not fields[0].isdigit():
        raise ValueError(f"invalid cron '{cron}': a schedule runs at most once an hour, so its minute is one number")
    return " ".join(fields)


def is_valid_cron_part(part: str, field: CronField) -> bool:
    """A value, a range or `*`, each with an optional step, such as `MON-FRI` or `*/2`."""
    span, has_step, step = part.partition("/")
    if has_step and not (step.isdigit() and int(step) >= 1):
        return False
    if span == "*":
        return True
    bounds = [field.names.get(bound.upper(), bound) for bound in span.split("-")]
    if len(bounds) > 2 or not all(str(bound).isdigit() for bound in bounds):
        return False
    values = [int(bound) for bound in bounds]
    return values == sorted(values) and field.lowest <= values[0] and values[-1] <= field.highest


def validate_model_name(model: str) -> str:
    provider, _, model_id = model.partition(":")
    if not provider or not model_id:
        raise ValueError(f"invalid model '{model}', expected the format 'provider:model_id'")
    return model
