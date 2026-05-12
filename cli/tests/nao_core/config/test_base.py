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


def test_default_templates_exclude_profiling():
    """Default templates should not include profiling."""
    from nao_core.config.databases.base import DatabaseTemplate

    db = DuckDBConfig(name="test-db", path=":memory:")
    assert DatabaseTemplate.PROFILING not in db.templates


def test_configure_profiling_templates_adds_profiling_when_enabled():
    """Profiling template should be added when user opts in."""
    from nao_core.config.databases.base import DatabaseTemplate

    db = DuckDBConfig(name="test-db", path=":memory:")
    result = NaoConfig._configure_profiling_templates(databases=[db], enable_profiling=True)
    assert DatabaseTemplate.PROFILING in result[0].templates


def test_configure_profiling_templates_skips_when_disabled():
    """Profiling template should not be added when user opts out."""
    from nao_core.config.databases.base import DatabaseTemplate

    db = DuckDBConfig(name="test-db", path=":memory:")
    result = NaoConfig._configure_profiling_templates(databases=[db], enable_profiling=False)
    assert DatabaseTemplate.PROFILING not in result[0].templates


def test_configure_profiling_templates_does_not_duplicate():
    """Profiling template should only appear once."""
    from nao_core.config.databases.base import DatabaseTemplate

    db = DuckDBConfig(name="test-db", path=":memory:")
    db.templates.append(DatabaseTemplate.PROFILING)
    result = NaoConfig._configure_profiling_templates(databases=[db], enable_profiling=True)
    assert result[0].templates.count(DatabaseTemplate.PROFILING) == 1


@patch("nao_core.config.base.ask_confirm")
def test_prompt_enable_profiling_returns_true_when_accepted(mock_confirm):
    """Profiling prompt should return True when user accepts."""
    mock_confirm.return_value = True
    db = DuckDBConfig(name="test-db", path=":memory:")
    assert NaoConfig._prompt_enable_profiling([db]) is True


@patch("nao_core.config.base.ask_confirm")
def test_prompt_enable_profiling_returns_false_when_declined(mock_confirm):
    """Profiling prompt should return False when user declines."""
    mock_confirm.return_value = False
    db = DuckDBConfig(name="test-db", path=":memory:")
    assert NaoConfig._prompt_enable_profiling([db]) is False


def test_prompt_enable_profiling_returns_false_without_databases():
    """Profiling prompt should return False when no databases are configured."""
    assert NaoConfig._prompt_enable_profiling([]) is False


def test_query_history_exclude_patterns_default_is_empty():
    db = DuckDBConfig(name="test-db", path=":memory:")
    assert db.query_history_exclude_patterns == []
    assert db.query_history_sql is None


def test_query_history_exclude_patterns_filters_matching_queries():
    db = DuckDBConfig(
        name="test-db",
        path=":memory:",
        query_history_exclude_patterns=[r"SYSTEM\$", r"CURRENT_SESSION\(\)"],
    )
    queries = [
        "SELECT * FROM users",
        "CALL SYSTEM$GET_RECENT_IN_APP_NOTIFICATIONS()",
        "SELECT CURRENT_SESSION()",
        "select current_session()",
        "SELECT id FROM orders",
    ]
    assert db.filter_query_history(queries) == [
        "SELECT * FROM users",
        "SELECT id FROM orders",
    ]


def test_filter_query_history_returns_input_when_no_patterns():
    db = DuckDBConfig(name="test-db", path=":memory:")
    queries = ["SELECT 1", "SELECT 2"]
    assert db.filter_query_history(queries) == queries


def test_custom_query_history_sql_overrides_default():
    from nao_core.config.databases.snowflake import SnowflakeConfig

    db = SnowflakeConfig(
        name="snow",
        username="u",
        account_id="a",
        database="d",
        password="p",
        query_history_sql="SELECT regexp_replace(query_text, '-- .*$', '') AS query_text FROM custom WHERE ts > current_timestamp - interval '{days} days'",
    )
    sql = db.get_query_history_sql(7)
    assert sql is not None
    assert "FROM custom" in sql
    assert "interval '7 days'" in sql
    assert "ACCOUNT_USAGE.QUERY_HISTORY" not in sql


def test_custom_query_history_sql_without_days_placeholder_is_passthrough():
    db = DuckDBConfig(
        name="duck",
        path=":memory:",
        query_history_sql="SELECT q AS query_text FROM my_logs",
    )
    assert db.get_query_history_sql(30) == "SELECT q AS query_text FROM my_logs"


def test_default_query_history_sql_used_when_no_override():
    from nao_core.config.databases.postgres import PostgresConfig

    db = PostgresConfig(name="pg", host="h", port=5432, database="d", user="u", password="p")
    sql = db.get_query_history_sql(30)
    assert sql is not None
    assert "pg_stat_statements" in sql


def test_query_history_sql_unsupported_database_returns_none_when_no_override():
    db = DuckDBConfig(name="duck", path=":memory:")
    assert db.get_query_history_sql(30) is None


def test_query_history_fields_loaded_from_yaml_dict():
    db = DuckDBConfig.model_validate(
        {
            "type": "duckdb",
            "name": "test-db",
            "path": ":memory:",
            "templates": ["columns", "how_to_use"],
            "query_history_days": 7,
            "query_history_sql": "SELECT q AS query_text FROM log WHERE ts > now() - interval '{days} days'",
            "query_history_exclude_patterns": [r"SYSTEM\$", r"CURRENT_SESSION"],
        }
    )
    assert db.query_history_days == 7
    assert db.query_history_exclude_patterns == [r"SYSTEM\$", r"CURRENT_SESSION"]
    assert db.get_query_history_sql(7) == "SELECT q AS query_text FROM log WHERE ts > now() - interval '7 days'"
