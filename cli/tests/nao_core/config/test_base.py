import os
import warnings
from unittest.mock import patch

import pytest
from pydantic import ValidationError

from nao_core.config.base import LLM_OVERRIDE_NOTICE, NaoConfig, annotate_llm_override, annotate_optional_templates
from nao_core.config.databases.base import DatabaseTemplate, ProfilingRefreshPolicy
from nao_core.config.databases.duckdb import DuckDBConfig
from nao_core.config.llm import LLMConfig, LLMProvider, ProviderConfig
from nao_core.config.secrets import process_secrets


def test_env_var_replacement():
    """Test replacement of a environment variable."""
    with patch.dict(os.environ, {"TEST_VAR": "test_value"}):
        content = "database: ${{ env('TEST_VAR') }}"
        result, _ = process_secrets(content)
        assert result == "database: test_value"


def test_multiple_env_vars_replacement():
    """Test replacement of multiple environment variables."""
    with patch.dict(os.environ, {"VAR1": "value1", "VAR2": "value2"}):
        content = "host: ${{ env('VAR1') }}, port: ${{ env('VAR2') }}"
        result, _ = process_secrets(content)
        assert result == "host: value1, port: value2"


def test_missing_env_var_returns_empty_string():
    """Test that missing environment variable is replaced with empty string."""
    with patch.dict(os.environ, {}):
        content = "value: ${{ env('NONEXISTENT_VAR') }}"
        result, _ = process_secrets(content)
        assert result == "value: "


def test_same_env_var_multiple_times():
    """Test the same environment variable used multiple times."""
    with patch.dict(os.environ, {"REPEATED": "repeated_value"}):
        content = "${{ env('REPEATED') }} and ${{ env('REPEATED') }} again"
        result, _ = process_secrets(content)
        assert result == "repeated_value and repeated_value again"


def test_env_var_without_dollar_prefix():
    """Test replacement without $ prefix (Jinja2-style syntax)."""
    with patch.dict(os.environ, {"API_KEY": "secret123"}):
        content = "api_key: {{ env('API_KEY') }}"
        result, _ = process_secrets(content)
        assert result == "api_key: secret123"


def test_mixed_dollar_and_no_dollar_syntax():
    """Test that both ${{ }} and {{ }} formats work together."""
    with patch.dict(os.environ, {"VAR1": "value1", "VAR2": "value2"}):
        content = "a: ${{ env('VAR1') }}, b: {{ env('VAR2') }}"
        result, _ = process_secrets(content)
        assert result == "a: value1, b: value2"


def test_threads_can_be_loaded_from_config(tmp_path):
    config_file = tmp_path / "nao_config.yaml"
    config_file.write_text("project_name: test-project\nthreads: 4\n")

    config = NaoConfig.load(tmp_path)

    assert config.threads == 4


def test_threads_must_be_positive():
    with pytest.raises(ValidationError):
        NaoConfig.model_validate({"project_name": "test-project", "threads": 0})


@patch("nao_core.config.base.ask_confirm")
@patch("nao_core.config.llm.LLMConfig.promptConfig")
def test_prompt_llm_skips_annotation_model_prompt(mock_prompt_config, mock_confirm):
    mock_llm = LLMConfig(providers=[ProviderConfig(provider=LLMProvider.OPENAI, api_key="sk-test")])
    mock_prompt_config.return_value = mock_llm
    mock_confirm.return_value = True

    llm = NaoConfig._prompt_llm()

    assert llm == mock_llm
    mock_prompt_config.assert_called_once_with(prompt_annotation_model=False)


@patch("nao_core.config.base.ask_confirm")
@patch("nao_core.config.llm.LLMConfig.promptConfig")
def test_prompt_llm_returns_none_when_skipped(mock_prompt_config, mock_confirm):
    mock_confirm.return_value = False

    llm = NaoConfig._prompt_llm()

    assert llm is None
    mock_prompt_config.assert_not_called()


def test_apply_default_templates_without_llm():
    db = DuckDBConfig(name="test-db", path=":memory:")

    NaoConfig._apply_default_templates([db], llm=None)

    assert db.templates == [DatabaseTemplate.COLUMNS, DatabaseTemplate.PREVIEW]


def test_apply_default_templates_with_llm():
    db = DuckDBConfig(name="test-db", path=":memory:")
    llm = LLMConfig(providers=[ProviderConfig(provider=LLMProvider.OPENAI, api_key="sk-test")])

    NaoConfig._apply_default_templates([db], llm=llm)

    assert db.templates == [
        DatabaseTemplate.COLUMNS,
        DatabaseTemplate.PREVIEW,
        DatabaseTemplate.AI_SUMMARY,
    ]


def test_fresh_prompt_flow_only_collects_database_llm_and_repos():
    db = DuckDBConfig(name="test-db", path=":memory:")
    llm = LLMConfig(providers=[ProviderConfig(provider=LLMProvider.OPENAI, api_key="sk-test")])
    prompt_order = []

    with (
        patch.object(NaoConfig, "_prompt_databases", side_effect=lambda: prompt_order.append("database") or [db]),
        patch.object(NaoConfig, "_prompt_llm", side_effect=lambda: prompt_order.append("llm") or llm),
        patch.object(NaoConfig, "_prompt_repos", side_effect=lambda: prompt_order.append("repos") or []),
    ):
        config = NaoConfig.promptConfig("test-project")

    assert prompt_order == ["database", "llm", "repos"]
    assert config.databases[0].templates == [
        DatabaseTemplate.COLUMNS,
        DatabaseTemplate.PREVIEW,
        DatabaseTemplate.AI_SUMMARY,
    ]
    assert config.slack is None
    assert config.notion is None
    assert config.mcp is None
    assert config.skills is None


def test_extend_handles_no_databases_and_no_llm():
    existing = NaoConfig(project_name="test-project")

    with (
        patch.object(NaoConfig, "_prompt_databases", return_value=[]),
        patch.object(NaoConfig, "_prompt_repos", return_value=[]),
        patch.object(NaoConfig, "_prompt_llm", return_value=None),
        patch("nao_core.config.base.UI"),
    ):
        config = NaoConfig.promptConfig("ignored", existing=existing)

    assert config.databases == []
    assert config.llm is None


def test_annotate_optional_templates_adds_both_comments(tmp_path):
    config_path = tmp_path / "nao_config.yaml"
    config_path.write_text(
        "databases:\n  - type: duckdb\n    templates:\n      - columns\n      - preview\n      - ai_summary\n"
    )

    annotate_optional_templates(config_path)

    assert config_path.read_text() == (
        "databases:\n"
        "  - type: duckdb\n"
        "    templates:\n"
        "      - columns\n"
        "      - preview\n"
        "      - ai_summary\n"
        "      # - profiling  -- Adds profiling of your data in agent context\n"
        "      # - query_history  -- Pulls most frequent queries / joins on each table\n"
    )


def test_annotate_optional_templates_skips_selected_template(tmp_path):
    config_path = tmp_path / "nao_config.yaml"
    config_path.write_text("databases:\n- type: duckdb\n  templates:\n  - columns\n  - profiling\n")

    annotate_optional_templates(config_path)

    content = config_path.read_text()
    assert "# - profiling" not in content
    assert "  # - query_history  -- Pulls most frequent queries / joins on each table\n" in content


def test_annotate_optional_templates_handles_multiple_databases(tmp_path):
    config_path = tmp_path / "nao_config.yaml"
    config_path.write_text(
        "databases:\n"
        "- type: duckdb\n"
        "  templates:\n"
        "  - columns\n"
        "- type: postgres\n"
        "  templates:\n"
        "  - columns\n"
        "  - query_history\n"
    )

    annotate_optional_templates(config_path)

    content = config_path.read_text()
    assert content.count("# - profiling") == 2
    assert content.count("# - query_history") == 1


def test_annotate_optional_templates_is_noop_without_templates_block(tmp_path):
    config_path = tmp_path / "nao_config.yaml"
    original = "project_name: test-project\ndatabases: []\n"
    config_path.write_text(original)

    annotate_optional_templates(config_path)

    assert config_path.read_text() == original


def test_annotate_llm_override_comments_above_the_llm_block(tmp_path):
    config_path = tmp_path / "nao_config.yaml"
    config_path.write_text("project_name: test-project\nllm:\n  providers:\n  - provider: openai\n")

    annotate_llm_override(config_path)

    assert config_path.read_text() == (
        "project_name: test-project\n"
        f"{LLM_OVERRIDE_NOTICE[0]}\n"
        f"{LLM_OVERRIDE_NOTICE[1]}\n"
        "llm:\n"
        "  providers:\n"
        "  - provider: openai\n"
    )


def test_annotate_llm_override_is_noop_without_llm_block(tmp_path):
    config_path = tmp_path / "nao_config.yaml"
    original = "project_name: test-project\ndatabases: []\n"
    config_path.write_text(original)

    annotate_llm_override(config_path)

    assert config_path.read_text() == original


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


def test_query_history_template_variant():
    """query_history can be added to the templates list."""
    from nao_core.config.databases.base import DatabaseTemplate

    with warnings.catch_warnings(record=True) as caught:
        warnings.simplefilter("always")
        db = DuckDBConfig.model_validate(
            {
                "type": "duckdb",
                "name": "test-db",
                "path": ":memory:",
                "templates": ["columns", "query_history"],
                "query_history_days": 14,
            }
        )

    assert DatabaseTemplate.QUERY_HISTORY in db.templates
    assert db.query_history_days == 14
    assert not [warning for warning in caught if issubclass(warning.category, FutureWarning)]


def test_legacy_description_removed_and_how_to_use_maps_to_query_history():
    """Legacy templates are migrated with warnings."""
    from nao_core.config.databases.base import DatabaseTemplate

    with warnings.catch_warnings(record=True) as caught:
        warnings.simplefilter("always")
        db = DuckDBConfig.model_validate(
            {
                "type": "duckdb",
                "name": "test-db",
                "path": ":memory:",
                "templates": ["columns", "description", "how_to_use"],
            }
        )

    assert db.templates == [DatabaseTemplate.COLUMNS, DatabaseTemplate.QUERY_HISTORY]
    deprecation_warnings = [warning for warning in caught if issubclass(warning.category, FutureWarning)]
    assert len(deprecation_warnings) == 2
    warning_messages = [str(warning.message) for warning in deprecation_warnings]
    assert any("description" in message and "columns.md" in message for message in warning_messages)
    assert any("how_to_use" in message and "query_history" in message for message in warning_messages)


def test_default_templates_exclude_profiling():
    """Default templates should not include profiling."""
    from nao_core.config.databases.base import DatabaseTemplate

    db = DuckDBConfig(name="test-db", path=":memory:")
    assert DatabaseTemplate.PROFILING not in db.templates


def test_ai_summary_refresh_config_defaults_to_always():
    db = DuckDBConfig(name="test-db", path=":memory:")

    assert db.ai_summary.refresh_policy == ProfilingRefreshPolicy.ALWAYS
    assert db.ai_summary.interval_days == 7


@pytest.mark.parametrize("refresh_policy", ["once", "interval"])
def test_ai_summary_refresh_config_accepts_policy_and_interval(refresh_policy):
    db = DuckDBConfig.model_validate(
        {
            "type": "duckdb",
            "name": "test-db",
            "path": ":memory:",
            "ai_summary": {
                "refresh_policy": refresh_policy,
                "interval_days": 14,
            },
        }
    )

    assert db.ai_summary.refresh_policy == ProfilingRefreshPolicy(refresh_policy)
    assert db.ai_summary.interval_days == 14


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


def test_exclude_columns_default_is_empty():
    db = DuckDBConfig(name="test-db", path=":memory:")
    assert db.exclude_columns == []


def test_exclude_columns_matches_against_schema_table_column():
    db = DuckDBConfig(
        name="test-db",
        path=":memory:",
        exclude_columns=["*.version", "analytics.events.*_id"],
    )
    assert db.column_matches_pattern("analytics", "users", "name") is True
    assert db.column_matches_pattern("analytics", "users", "version") is False
    assert db.column_matches_pattern("analytics", "events", "user_id") is False
    assert db.column_matches_pattern("staging", "events", "user_id") is True


def test_exclude_columns_supports_glob_in_column_name():
    db = DuckDBConfig(
        name="test-db",
        path=":memory:",
        exclude_columns=["*._peerdb_*"],
    )
    assert db.column_matches_pattern("analytics", "users", "_peerdb_version") is False
    assert db.column_matches_pattern("analytics", "users", "name") is True


def test_exclude_columns_loaded_from_yaml_dict():
    db = DuckDBConfig.model_validate(
        {
            "type": "duckdb",
            "name": "test-db",
            "path": ":memory:",
            "exclude_columns": ["*._peerdb_*", "*.sign", "*.version"],
        }
    )
    assert db.exclude_columns == ["*._peerdb_*", "*.sign", "*.version"]


def test_query_history_fields_loaded_from_yaml_dict():
    db = DuckDBConfig.model_validate(
        {
            "type": "duckdb",
            "name": "test-db",
            "path": ":memory:",
            "templates": ["columns", "query_history"],
            "query_history_days": 7,
            "query_history_sql": "SELECT q AS query_text FROM log WHERE ts > now() - interval '{days} days'",
            "query_history_exclude_patterns": [r"SYSTEM\$", r"CURRENT_SESSION"],
        }
    )
    assert db.query_history_days == 7
    assert db.query_history_exclude_patterns == [r"SYSTEM\$", r"CURRENT_SESSION"]
    assert db.get_query_history_sql(7) == "SELECT q AS query_text FROM log WHERE ts > now() - interval '7 days'"
