"""Unit tests for the migrate command."""

from pathlib import Path

from nao_core.commands.migrate import migrate_llm_block
from nao_core.config.llm import LLMConfig, LLMProvider

MODELS_HINT = """\
    # models:
    # - id: your-model-id
    #   costs:  # US dollars per million tokens
    #     input_no_cache: 3
    #     input_cache_read: 0.3
    #     input_cache_write: 3.75
    #     output: 15
"""


def test_nests_a_single_provider_under_providers():
    content = """\
project_name: example
llm:
  provider: anthropic
  api_key: sk-test
slack: null
"""

    assert migrate_llm_block(content) == (
        """\
project_name: example
llm:
  providers:
  - provider: anthropic
    api_key: sk-test
"""
        + MODELS_HINT
        + "slack: null\n"
    )


def test_finds_llm_block_with_inline_comment():
    content = """\
llm: # shared provider
  provider: anthropic
  api_key: sk-test
"""

    migrated = migrate_llm_block(content)

    assert migrated is not None
    assert migrated.startswith(
        """\
llm: # shared provider
  providers:
  - provider: anthropic
"""
    )


def test_keeps_llm_level_keys_in_place():
    content = """\
llm:
  provider: anthropic
  api_key: sk-test
  annotation_model: claude-3-5-haiku-latest
  meta:
    costs:
      output: 15
"""

    migrated = migrate_llm_block(content)

    assert migrated is not None
    assert migrated.endswith(
        """\
  annotation_model: claude-3-5-haiku-latest
  meta:
    costs:
      output: 15
"""
    )
    assert "  - provider: anthropic\n" in migrated


def test_preserves_env_placeholders_and_comments():
    content = """\
llm:
  # our shared gateway
  provider: openai
  api_key: ${{ env('OPENAI_API_KEY') }}
  base_url: http://localhost:4000 # litellm
"""

    migrated = migrate_llm_block(content)

    assert migrated is not None
    assert "${{ env('OPENAI_API_KEY') }}" in migrated
    assert "base_url: http://localhost:4000 # litellm" in migrated
    assert migrated.startswith(
        """\
llm:
  providers:
    # our shared gateway
  - provider: openai
"""
    )


def test_uses_first_property_indentation_after_blank_line():
    content = """\
llm:

  provider: anthropic
  api_key: sk-test
"""

    migrated = migrate_llm_block(content)

    assert migrated is not None
    assert migrated.startswith(
        """\
llm:
  providers:

  - provider: anthropic
    api_key: sk-test
"""
    )


def test_multiline_credentials_keep_their_relative_indentation():
    content = """\
llm:
  provider: vertex
  gcp_project: my-project
  service_account_json: |
    {
      "client_email": "sa@project.iam.gserviceaccount.com"
    }
"""

    migrated = migrate_llm_block(content)

    assert migrated is not None
    assert "    service_account_json: |\n" in migrated
    assert '        "client_email": "sa@project.iam.gserviceaccount.com"\n' in migrated


def test_returns_none_when_already_migrated():
    content = """\
llm:
  providers:
  - provider: anthropic
    api_key: sk-test
"""

    assert migrate_llm_block(content) is None


def test_returns_none_without_an_llm_block():
    assert migrate_llm_block("project_name: example\n") is None


def test_migrated_output_loads_into_the_current_shape(tmp_path: Path):
    content = """\
project_name: example
llm:
  provider: bedrock
  aws_region: eu-west-1
  access_key: AKIA_TEST
  secret_key: SECRET_TEST
  annotation_model: anthropic.claude-3-5-sonnet-20241022-v2:0
"""

    migrated = migrate_llm_block(content)
    assert migrated is not None

    config_path = tmp_path / "nao_config.yaml"
    config_path.write_text(migrated)

    import yaml

    data = yaml.safe_load(config_path.read_text())
    assert not LLMConfig.uses_legacy_shape(data["llm"])

    config = LLMConfig.model_validate(data["llm"])
    provider_config = config.providers[0]
    assert provider_config.provider == LLMProvider.BEDROCK
    assert provider_config.aws_region == "eu-west-1"
    assert provider_config.access_key == "AKIA_TEST"
    assert provider_config.secret_key == "SECRET_TEST"
    assert config.annotation_model == "anthropic.claude-3-5-sonnet-20241022-v2:0"
