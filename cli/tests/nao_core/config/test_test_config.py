import pytest
from pydantic import ValidationError

from nao_core.config.base import NaoConfig
from nao_core.config.test import TestConfig


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
    assert test_config.comparison.rtol == 1e-5
    assert test_config.comparison.atol == 1e-8
    assert test_config.comparison.decimals == 2


@pytest.mark.parametrize("model", ["gpt-4.1", "openai:", ":gpt-4.1"])
def test_models_must_declare_a_provider_and_a_model_id(model):
    with pytest.raises(ValidationError, match="provider:model_id"):
        TestConfig(models=[model])


def test_threads_must_be_positive():
    with pytest.raises(ValidationError):
        TestConfig(threads=0)
