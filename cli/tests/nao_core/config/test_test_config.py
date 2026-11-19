import pytest
from pydantic import ValidationError

from nao_core.config.base import NaoConfig
from nao_core.config.test import TestConfig, TestModelConfig, TestScheduleConfig


def test_test_block_is_loaded_from_config(tmp_path):
    config_file = tmp_path / "nao_config.yaml"
    config_file.write_text(
        "project_name: test-project\n"
        "test:\n"
        "  models:\n"
        "  - openai:gpt-4.1\n"
        "  - anthropic:claude-sonnet-4-5\n"
        "  threads: 4\n"
        "  comparison:\n"
        "    rtol: 0.001\n"
        "    atol: 0.01\n"
        "    decimals: 4\n"
    )

    config = NaoConfig.load(tmp_path)

    assert config.test is not None
    assert config.test.models == ["openai:gpt-4.1", "anthropic:claude-sonnet-4-5"]
    assert config.test.threads == 4
    assert config.test.comparison.rtol == 0.001
    assert config.test.comparison.atol == 0.01
    assert config.test.comparison.decimals == 4


def test_test_block_is_optional():
    config = NaoConfig(project_name="test-project")

    assert config.test is None


def test_defaults():
    test_config = TestConfig()

    assert test_config.models == ["openai:gpt-4.1"]
    assert test_config.threads == 1
    assert test_config.k == 1
    assert test_config.comparison.rtol == 1e-5
    assert test_config.comparison.atol == 1e-8
    assert test_config.comparison.decimals == 2


@pytest.mark.parametrize("model", ["gpt-4.1", "openai:", ":gpt-4.1"])
def test_models_must_declare_a_provider_and_a_model_id(model):
    with pytest.raises(ValidationError, match="provider:model_id"):
        TestConfig(models=[model])


@pytest.mark.parametrize("field", ["threads", "k"])
def test_counts_must_be_positive(field):
    with pytest.raises(ValidationError):
        TestConfig.model_validate({field: 0})


def test_k_is_loaded_from_config(tmp_path):
    config_file = tmp_path / "nao_config.yaml"
    config_file.write_text("project_name: test-project\ntest:\n  k: 5\n")

    config = NaoConfig.load(tmp_path)

    assert config.test is not None
    assert config.test.k == 5


def test_models_can_list_reasoning_efforts(tmp_path):
    config_file = tmp_path / "nao_config.yaml"
    config_file.write_text(
        "project_name: test-project\n"
        "test:\n"
        "  models:\n"
        "  - openai:gpt-4.1\n"
        "  - model: anthropic:claude-sonnet-4-5\n"
        "    reasoning_efforts: [low, high]\n"
        "  - model: openai:gpt-5\n"
        "    reasoning_efforts: all\n"
    )

    config = NaoConfig.load(tmp_path)

    assert config.test is not None
    assert config.test.models == [
        "openai:gpt-4.1",
        TestModelConfig(model="anthropic:claude-sonnet-4-5", reasoning_efforts=["low", "high"]),
        TestModelConfig(model="openai:gpt-5", reasoning_efforts="all"),
    ]


@pytest.mark.parametrize(
    "entry",
    [
        {"model": "gpt-5", "reasoning_efforts": ["low"]},
        {"model": "openai:gpt-5", "reasoning_efforts": []},
        {"model": "openai:gpt-5", "reasoning_efforts": ["extreme"]},
        {"model": "openai:gpt-5", "reasoning_effort": ["low"]},
    ],
)
def test_models_with_reasoning_efforts_are_validated(entry):
    with pytest.raises(ValidationError):
        TestConfig(models=[entry])


def test_schedules_are_loaded_from_config(tmp_path):
    config_file = tmp_path / "nao_config.yaml"
    config_file.write_text(
        "project_name: test-project\n"
        "test:\n"
        "  schedules:\n"
        "  - cron: 0 6 * * *\n"
        "  - cron: 30 8 * * 1\n"
        "    tags: [smoke]\n"
        "    models: [openai:gpt-4.1]\n"
        "    k: 3\n"
    )

    config = NaoConfig.load(tmp_path)

    assert config.test is not None
    assert config.test.schedules == [
        TestScheduleConfig(cron="0 6 * * *"),
        TestScheduleConfig(cron="30 8 * * 1", tags=["smoke"], models=["openai:gpt-4.1"], k=3),
    ]


@pytest.mark.parametrize(
    "schedule",
    [
        {"cron": "every morning"},
        {"cron": "99 99 * * *"},
        {"cron": "0 25 * * *"},
        {"cron": "0 6 * * 9"},
        {"cron": "0 6 5-1 * *"},
        {"cron": "0 6 * */0 *"},
        {"cron": "*/5 * * * *"},
        {"cron": "0,30 6 * * *"},
        {"cron": "0 6 * * *", "k": 0},
        {"cron": "0 6 * * *", "models": ["gpt-4.1"]},
        {"cron": "0 6 * * *", "tag": ["smoke"]},
    ],
)
def test_schedules_are_validated(schedule):
    with pytest.raises(ValidationError):
        TestConfig(schedules=[schedule])


@pytest.mark.parametrize(
    "cron",
    ["0 * * * *", "30 8 * * 1-5", "0 6 * * mon-fri", "0 6 1,15 */2 *", "15 0-23/6 * JAN-JUN 7"],
)
def test_schedules_accept_the_crons_the_app_runs(cron):
    assert TestScheduleConfig(cron=f"  {cron}  ").cron == cron
