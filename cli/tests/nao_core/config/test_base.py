import os
import warnings
from unittest.mock import patch

from nao_core.config.base import NaoConfig
from nao_core.config.databases.duckdb import DuckDBConfig
from nao_core.config.llm import LLMConfig, LLMProvider


def test_env_var_replacement():
    """Test replacement of a environment variable."""
    with patch.dict(os.environ, {"TEST_VAR": "test_value"}):
        content = "database: ${{ env('TEST_VAR') }}"
        result, _ = NaoConfig._process_env_vars(content)
        assert result == "database: test_value"


def test_multiple_env_vars_replacement():
    """Test replacement of multiple environment variables."""
    with patch.dict(os.environ, {"VAR1": "value1", "VAR2": "value2"}):
        content = "host: ${{ env('VAR1') }}, port: ${{ env('VAR2') }}"
        result, _ = NaoConfig._process_env_vars(content)
        assert result == "host: value1, port: value2"


def test_missing_env_var_returns_empty_string():
    """Test that missing environment variable is replaced with empty string."""
    with patch.dict(os.environ, {}):
        content = "value: ${{ env('NONEXISTENT_VAR') }}"
        result, _ = NaoConfig._process_env_vars(content)
        assert result == "value: "


def test_same_env_var_multiple_times():
    """Test the same environment variable used multiple times."""
    with patch.dict(os.environ, {"REPEATED": "repeated_value"}):
        content = "${{ env('REPEATED') }} and ${{ env('REPEATED') }} again"
        result, _ = NaoConfig._process_env_vars(content)
        assert result == "repeated_value and repeated_value again"


def test_env_var_without_dollar_prefix():
    """Test replacement without $ prefix (Jinja2-style syntax)."""
    with patch.dict(os.environ, {"API_KEY": "secret123"}):
        content = "api_key: {{ env('API_KEY') }}"
        result, _ = NaoConfig._process_env_vars(content)
        assert result == "api_key: secret123"


def test_mixed_dollar_and_no_dollar_syntax():
    """Test that both ${{ }} and {{ }} formats work together."""
    with patch.dict(os.environ, {"VAR1": "value1", "VAR2": "value2"}):
        content = "a: ${{ env('VAR1') }}, b: {{ env('VAR2') }}"
        result, _ = NaoConfig._process_env_vars(content)
        assert result == "a: value1, b: value2"


@patch("nao_core.config.base.ask_confirm")
@patch("nao_core.config.llm.LLMConfig.promptConfig")
def test_prompt_llm_skips_annotation_model_when_ai_summary_is_disabled(mock_prompt_config, mock_confirm):
    """Model prompt should be disabled when ai_summary is declined."""
    db = DuckDBConfig(name="test-db", path=":memory:")
    mock_llm = LLMConfig(provider=LLMProvider.OPENAI, api_key="sk-test")
    mock_prompt_config.return_value = mock_llm
    mock_confirm.side_effect = [True, False]

    llm, enable_ai_summary = NaoConfig._prompt_llm(databases=[db])

    assert llm == mock_llm
    assert enable_ai_summary is False
    mock_prompt_config.assert_called_once_with(prompt_annotation_model=False)


@patch("nao_core.config.base.ask_confirm")
@patch("nao_core.config.llm.LLMConfig.promptConfig")
def test_prompt_llm_prompts_annotation_model_when_ai_summary_is_enabled(mock_prompt_config, mock_confirm):
    """Model prompt should be enabled when ai_summary is accepted."""
    db = DuckDBConfig(name="test-db", path=":memory:")
    mock_llm = LLMConfig(provider=LLMProvider.OPENAI, api_key="sk-test")
    mock_prompt_config.return_value = mock_llm
    mock_confirm.side_effect = [True, True]

    llm, enable_ai_summary = NaoConfig._prompt_llm(databases=[db])

    assert llm == mock_llm
    assert enable_ai_summary is True
    mock_prompt_config.assert_called_once_with(prompt_annotation_model=True)


@patch("nao_core.config.base.ask_confirm")
@patch("nao_core.config.llm.LLMConfig.promptConfig")
def test_prompt_llm_returns_none_when_skipped(mock_prompt_config, mock_confirm):
    """LLM should remain unset when user skips LLM setup."""
    mock_confirm.return_value = False

    llm, enable_ai_summary = NaoConfig._prompt_llm(databases=[])

    assert llm is None
    assert enable_ai_summary is False
    mock_prompt_config.assert_not_called()


def test_configure_ai_summary_templates_does_not_duplicate_existing_template():
    """ai_summary template should only appear once."""
    from nao_core.config.databases.base import DatabaseTemplate

    db = DuckDBConfig(name="test-db", path=":memory:")
    db.templates = [DatabaseTemplate.COLUMNS, DatabaseTemplate.AI_SUMMARY]
    llm = LLMConfig(provider=LLMProvider.OPENAI, api_key="sk-test")

    result = NaoConfig._configure_ai_summary_templates(
        databases=[db],
        llm=llm,
        enable_ai_summary=True,
    )

    assert result[0].templates.count(DatabaseTemplate.AI_SUMMARY) == 1


def test_legacy_accessors_key_migrated_to_templates_with_warning():
    """The legacy 'accessors' YAML key should be accepted as 'templates' and emit a FutureWarning."""
    from nao_core.config.databases.base import DatabaseTemplate

    with warnings.catch_warnings(record=True) as caught:
        warnings.simplefilter("always")
        db = DuckDBConfig.model_validate(
            {"type": "duckdb", "name": "test-db", "path": ":memory:", "accessors": ["columns", "preview"]}
        )

    assert db.templates == [DatabaseTemplate.COLUMNS, DatabaseTemplate.PREVIEW]
    deprecation_warnings = [w for w in caught if issubclass(w.category, FutureWarning)]
    assert len(deprecation_warnings) == 1
    assert "accessors" in str(deprecation_warnings[0].message)
    assert "templates" in str(deprecation_warnings[0].message)


def test_templates_key_works_without_deprecation_warning():
    """The 'templates' key should work without emitting any deprecation warning."""
    from nao_core.config.databases.base import DatabaseTemplate

    with warnings.catch_warnings(record=True) as caught:
        warnings.simplefilter("always")
        db = DuckDBConfig.model_validate(
            {"type": "duckdb", "name": "test-db", "path": ":memory:", "templates": ["columns", "preview"]}
        )

    assert db.templates == [DatabaseTemplate.COLUMNS, DatabaseTemplate.PREVIEW]
    deprecation_warnings = [w for w in caught if issubclass(w.category, FutureWarning)]
    assert len(deprecation_warnings) == 0


def test_how_to_use_template_variant():
    """how_to_use can be added to the templates list."""
    from nao_core.config.databases.base import DatabaseTemplate

    db = DuckDBConfig.model_validate(
        {
            "type": "duckdb",
            "name": "test-db",
            "path": ":memory:",
            "templates": ["columns", "how_to_use"],
            "query_history_days": 14,
        }
    )
    assert DatabaseTemplate.HOW_TO_USE in db.templates
    assert db.query_history_days == 14
