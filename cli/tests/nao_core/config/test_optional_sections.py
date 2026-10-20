"""Loading with drop_invalid_optional_sections: integration blocks that fail
validation (typically an unset env('...') secret) are nulled with a warning so
commands that never read them, like `nao sync`, can still run."""

from pathlib import Path

import pytest
from pydantic import ValidationError

from nao_core.config.base import NaoConfig

ANTHROPIC_KEY_VAR = "TEST_OPTIONAL_SECTIONS_ANTHROPIC_KEY"
SECRET_ENV_VARS = (
    ANTHROPIC_KEY_VAR,
    "TEST_OPTIONAL_SECTIONS_SLACK_BOT",
    "TEST_OPTIONAL_SECTIONS_SLACK_SECRET",
)

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

METABASE_WITH_INVALID_KEY = """
metabase:
  url: https://metabase.example.com
  api_key:
"""


@pytest.fixture
def unset_secrets(monkeypatch):
    for name in SECRET_ENV_VARS:
        monkeypatch.delenv(name, raising=False)


def test_strict_load_still_fails_on_unresolved_llm_secret(tmp_path, unset_secrets):
    write_config(tmp_path, VALID_CORE + LLM_WITH_ENV_KEY)
    with pytest.raises(ValidationError):
        NaoConfig.load(tmp_path)


def test_invalid_optional_sections_are_dropped_with_flag(tmp_path, unset_secrets):
    write_config(tmp_path, VALID_CORE + LLM_WITH_ENV_KEY + SLACK_WITH_ENV_TOKENS + METABASE_WITH_INVALID_KEY)

    config = NaoConfig.load(tmp_path, drop_invalid_optional_sections=True)

    assert config.llm is None
    assert config.slack is None
    assert config.metabase is None
    assert config.project_name == "test-project"
    assert [db.name for db in config.databases] == ["local"]


def test_valid_sections_are_kept_with_flag(tmp_path, monkeypatch):
    write_config(tmp_path, VALID_CORE + LLM_WITH_ENV_KEY)
    monkeypatch.setenv(ANTHROPIC_KEY_VAR, "sk-test")

    config = NaoConfig.load(tmp_path, drop_invalid_optional_sections=True)

    assert config.llm is not None
    assert config.llm.providers[0].api_key == "sk-test"


def test_core_errors_still_fail_with_flag(tmp_path, unset_secrets):
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
    with pytest.raises((ValidationError, ValueError)):
        NaoConfig.load(tmp_path, drop_invalid_optional_sections=True)


def test_try_load_passes_the_flag_through(tmp_path, unset_secrets):
    write_config(tmp_path, VALID_CORE + LLM_WITH_ENV_KEY)

    strict = NaoConfig.try_load(tmp_path)
    assert strict is None

    lenient = NaoConfig.try_load(tmp_path, drop_invalid_optional_sections=True)
    assert lenient is not None
    assert lenient.llm is None


def write_config(path: Path, content: str) -> None:
    (path / "nao_config.yaml").write_text(content)
