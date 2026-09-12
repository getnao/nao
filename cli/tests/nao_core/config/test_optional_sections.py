"""Loading with drop_invalid_optional_sections: integration blocks that fail
validation (typically an unset env('...') secret) are nulled with a warning so
commands that never read them, like `nao sync`, can still run."""

import os
from pathlib import Path
from unittest.mock import patch

import pytest
from pydantic import ValidationError

from nao_core.config.base import NaoConfig

VALID_CORE = """
project_name: test-project
databases:
  - name: local
    type: duckdb
    path: ":memory:"
"""

LLM_WITH_ENV_KEY = """
llm:
  providers:
    - provider: anthropic
      api_key: "{{ env('TEST_OPTIONAL_SECTIONS_ANTHROPIC_KEY') }}"
"""

# Unquoted on purpose: with the env var unset the substitution leaves an empty
# YAML value, which parses as null — the shape this feature exists for.
SLACK_WITH_ENV_TOKENS = """
slack:
  bot_token: {{ env('TEST_OPTIONAL_SECTIONS_SLACK_BOT') }}
  signing_secret: {{ env('TEST_OPTIONAL_SECTIONS_SLACK_SECRET') }}
"""


def write_config(path: Path, content: str) -> None:
    (path / "nao_config.yaml").write_text(content)


def test_strict_load_still_fails_on_unresolved_llm_secret(tmp_path):
    write_config(tmp_path, VALID_CORE + LLM_WITH_ENV_KEY)
    with patch.dict(os.environ, {}, clear=False):
        os.environ.pop("TEST_OPTIONAL_SECTIONS_ANTHROPIC_KEY", None)
        with pytest.raises(ValidationError):
            NaoConfig.load(tmp_path)


def test_invalid_llm_and_slack_are_dropped_with_flag(tmp_path):
    write_config(tmp_path, VALID_CORE + LLM_WITH_ENV_KEY + SLACK_WITH_ENV_TOKENS)
    with patch.dict(os.environ):
        for var in (
            "TEST_OPTIONAL_SECTIONS_ANTHROPIC_KEY",
            "TEST_OPTIONAL_SECTIONS_SLACK_BOT",
            "TEST_OPTIONAL_SECTIONS_SLACK_SECRET",
        ):
            os.environ.pop(var, None)

        config = NaoConfig.load(tmp_path, drop_invalid_optional_sections=True)

    assert config.llm is None
    assert config.slack is None
    assert config.project_name == "test-project"
    assert [db.name for db in config.databases] == ["local"]


def test_valid_sections_are_kept_with_flag(tmp_path):
    write_config(tmp_path, VALID_CORE + LLM_WITH_ENV_KEY)
    with patch.dict(os.environ, {"TEST_OPTIONAL_SECTIONS_ANTHROPIC_KEY": "sk-test"}):
        config = NaoConfig.load(tmp_path, drop_invalid_optional_sections=True)

    assert config.llm is not None
    assert config.llm.providers[0].api_key == "sk-test"


def test_core_errors_still_fail_with_flag(tmp_path):
    write_config(
        tmp_path,
        """
project_name: test-project
databases:
  - name: broken
    type: not-a-database
"""
        + LLM_WITH_ENV_KEY,
    )
    with patch.dict(os.environ):
        os.environ.pop("TEST_OPTIONAL_SECTIONS_ANTHROPIC_KEY", None)
        with pytest.raises((ValidationError, ValueError)):
            NaoConfig.load(tmp_path, drop_invalid_optional_sections=True)


def test_try_load_passes_the_flag_through(tmp_path):
    write_config(tmp_path, VALID_CORE + LLM_WITH_ENV_KEY)
    with patch.dict(os.environ):
        os.environ.pop("TEST_OPTIONAL_SECTIONS_ANTHROPIC_KEY", None)

        strict = NaoConfig.try_load(tmp_path)
        assert strict is None

        lenient = NaoConfig.try_load(tmp_path, drop_invalid_optional_sections=True)
        assert lenient is not None
        assert lenient.llm is None
