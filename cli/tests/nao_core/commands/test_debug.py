from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest

from nao_core.commands.debug import check_llm_connection, debug
from nao_core.config.databases import BigQueryConfig, ClickHouseConfig, DuckDBConfig, PostgresConfig, TrinoConfig
from nao_core.config.llm import LLMProvider, ModelConfig, ProviderConfig


class TestLLMConnection:
    """
    Tests for check_llm_connection.
    """

    def test_openai_connection_success(self):
        config = ProviderConfig(provider=LLMProvider.OPENAI, api_key="sk-test-api-key")

        with patch("openai.OpenAI") as mock_openai_class:
            mock_client = MagicMock()
            mock_client.models.list.return_value = [MagicMock(), MagicMock(), MagicMock()]
            mock_openai_class.return_value = mock_client

            success, message = check_llm_connection(config)

            assert success is True
            assert "Connected successfully" in message
            assert "3 models available" in message
            mock_openai_class.assert_called_once_with(api_key="sk-test-api-key", base_url=None)

    def test_openai_warns_when_configured_models_missing(self):
        config = ProviderConfig(
            provider=LLMProvider.OPENAI,
            api_key="sk-test-api-key",
            models=[ModelConfig(id="gpt-4.1"), ModelConfig(id="gpt-missing")],
        )

        with patch("openai.OpenAI") as mock_openai_class:
            mock_client = MagicMock()
            mock_client.models.list.return_value = [
                SimpleNamespace(id="gpt-4.1"),
                SimpleNamespace(id="gpt-4o"),
            ]
            mock_openai_class.return_value = mock_client

            success, message = check_llm_connection(config)

            assert success is True
            assert "Connected successfully" in message
            assert "Warning: configured model(s) not in provider list: gpt-missing" in message

    def test_openai_no_warning_when_configured_models_available(self):
        config = ProviderConfig(
            provider=LLMProvider.OPENAI,
            api_key="sk-test-api-key",
            models=[ModelConfig(id="gpt-4.1"), ModelConfig(id="gpt-4o")],
        )

        with patch("openai.OpenAI") as mock_openai_class:
            mock_client = MagicMock()
            mock_client.models.list.return_value = [
                SimpleNamespace(id="gpt-4.1"),
                SimpleNamespace(id="gpt-4o"),
            ]
            mock_openai_class.return_value = mock_client

            success, message = check_llm_connection(config)

            assert success is True
            assert "Warning:" not in message

    def test_gemini_matches_models_prefix(self):
        config = ProviderConfig(
            provider=LLMProvider.GEMINI,
            api_key="test-gemini-key",
            models=[ModelConfig(id="gemini-2.0-flash")],
        )

        with patch("google.genai.Client") as mock_client_class:
            mock_client = MagicMock()
            mock_client.models.list.return_value = [SimpleNamespace(name="models/gemini-2.0-flash")]
            mock_client_class.return_value = mock_client

            success, message = check_llm_connection(config)

            assert success is True
            assert "Warning:" not in message

    def test_ollama_matches_tagged_model(self):
        config = ProviderConfig(
            provider=LLMProvider.OLLAMA,
            models=[ModelConfig(id="llama3.2")],
        )

        with patch("ollama.list") as mock_list:
            mock_list.return_value.models = [SimpleNamespace(model="llama3.2:latest")]

            success, message = check_llm_connection(config)

            assert success is True
            assert "Warning:" not in message

    def test_bedrock_warns_when_configured_models_missing(self):
        config = ProviderConfig(
            provider=LLMProvider.BEDROCK,
            aws_region="us-east-1",
            models=[ModelConfig(id="anthropic.claude-3-5-sonnet-20241022-v2:0")],
        )

        with patch("boto3.Session") as mock_session_class:
            mock_client = MagicMock()
            mock_client.list_foundation_models.return_value = {"modelSummaries": [{"modelId": "amazon.nova-pro-v1:0"}]}
            mock_session_class.return_value.client.return_value = mock_client

            success, message = check_llm_connection(config)

            assert success is True
            assert (
                "Warning: configured model(s) not in provider list: anthropic.claude-3-5-sonnet-20241022-v2:0"
                in message
            )

    def test_openai_connection_uses_configured_base_url(self):
        """A custom base_url (e.g. a LiteLLM proxy) must reach the client, not the provider default."""
        config = ProviderConfig(
            provider=LLMProvider.OPENAI,
            api_key="sk-test-api-key",
            base_url="https://proxy.internal/v1",
        )

        with patch("openai.OpenAI") as mock_openai_class:
            mock_client = MagicMock()
            mock_client.models.list.return_value = [MagicMock()]
            mock_openai_class.return_value = mock_client

            success, _ = check_llm_connection(config)

            assert success is True
            mock_openai_class.assert_called_once_with(api_key="sk-test-api-key", base_url="https://proxy.internal/v1")

    def test_openai_exception_returns_failure(self):
        """API exception should return False with error message."""
        config = ProviderConfig(provider=LLMProvider.OPENAI, api_key="invalid")

        with patch("openai.OpenAI") as mock_class:
            mock_class.return_value.models.list.side_effect = Exception("Invalid API key")

            success, message = check_llm_connection(config)

            assert success is False
            assert "Invalid API key" in message

    def test_anthropic_connection_success(self):
        config = ProviderConfig(provider=LLMProvider.ANTHROPIC, api_key="sk-test-api-key")

        with patch("anthropic.Anthropic") as mock_anthropic_class:
            mock_client = MagicMock()
            mock_client.models.list.return_value = [MagicMock(), MagicMock(), MagicMock()]
            mock_anthropic_class.return_value = mock_client

            success, message = check_llm_connection(config)

            assert success is True
            assert "Connected successfully" in message
            assert "3 models available" in message
            mock_anthropic_class.assert_called_once_with(api_key="sk-test-api-key")

    def test_anthropic_connection_uses_configured_base_url(self):
        config = ProviderConfig(
            provider=LLMProvider.ANTHROPIC,
            api_key="sk-test-api-key",
            base_url="https://proxy.internal/anthropic",
        )

        with patch("anthropic.Anthropic") as mock_anthropic_class:
            mock_client = MagicMock()
            mock_client.models.list.return_value = [MagicMock()]
            mock_anthropic_class.return_value = mock_client

            success, _ = check_llm_connection(config)

            assert success is True
            mock_anthropic_class.assert_called_once_with(
                api_key="sk-test-api-key", base_url="https://proxy.internal/anthropic"
            )

    def test_anthropic_exception_returns_failure(self):
        """API exception should return False with error message."""
        config = ProviderConfig(provider=LLMProvider.ANTHROPIC, api_key="invalid")

        with patch("anthropic.Anthropic") as mock_class:
            mock_class.return_value.models.list.side_effect = Exception("Authentication failed")

            success, message = check_llm_connection(config)

            assert success is False
            assert "Authentication failed" in message

    def test_gemini_connection_success(self):
        config = ProviderConfig(provider=LLMProvider.GEMINI, api_key="test-gemini-key")

        with patch("google.genai.Client") as mock_client_class:
            mock_client = MagicMock()
            mock_client.models.list.return_value = [MagicMock(), MagicMock(), MagicMock()]
            mock_client_class.return_value = mock_client

            success, message = check_llm_connection(config)

            assert success is True
            assert "Connected successfully" in message
            assert "3 models available" in message
            mock_client_class.assert_called_once_with(api_key="test-gemini-key")

    def test_gemini_exception_returns_failure(self):
        """API exception should return False with error message."""
        config = ProviderConfig(provider=LLMProvider.GEMINI, api_key="invalid")

        with patch("google.genai.Client") as mock_client_class:
            mock_client_class.return_value.models.list.side_effect = Exception("Invalid API key")

            success, message = check_llm_connection(config)

            assert success is False
            assert "Invalid API key" in message

    def test_mistral_connection_success(self):
        config = ProviderConfig(provider=LLMProvider.MISTRAL, api_key="test-mistral-key")

        with patch("mistralai.Mistral") as mock_mistral_class:
            mock_client = MagicMock()
            mock_client = MagicMock()
            mock_client.models.list.return_value = [MagicMock(), MagicMock(), MagicMock()]
            mock_mistral_class.return_value = mock_client

            success, message = check_llm_connection(config)

            assert success is True
            assert "Connected successfully" in message
            assert "3 models available" in message
            mock_mistral_class.assert_called_once_with(api_key="test-mistral-key")

    def test_mistral_exception_returns_failure(self):
        """API exception should return False with error message."""
        config = ProviderConfig(provider=LLMProvider.MISTRAL, api_key="invalid")

        with patch("mistralai.Mistral") as mock_class:
            mock_class.return_value.models.list.side_effect = Exception("Unauthorized")

            success, message = check_llm_connection(config)

            assert success is False
            assert "Unauthorized" in message

    def test_openrouter_connection_success(self):
        config = ProviderConfig(provider=LLMProvider.OPENROUTER, api_key="sk-test-api-key")
        with patch("openai.OpenAI") as mock_openai_class:
            mock_client = MagicMock()
            mock_client.models.list.return_value = [MagicMock(), MagicMock(), MagicMock()]
            mock_openai_class.return_value = mock_client
            success, message = check_llm_connection(config)
            assert success is True
            assert "Connected successfully" in message
            assert "3 models available" in message
            # Verify OpenAI was called with OpenRouter base_url
            mock_openai_class.assert_called_once_with(
                base_url="https://openrouter.ai/api/v1", api_key="sk-test-api-key"
            )

    def test_openrouter_connection_uses_configured_base_url(self):
        """A configured base_url overrides the OpenRouter default endpoint."""
        config = ProviderConfig(
            provider=LLMProvider.OPENROUTER,
            api_key="sk-test-api-key",
            base_url="https://proxy.internal/v1",
        )
        with patch("openai.OpenAI") as mock_openai_class:
            mock_client = MagicMock()
            mock_client.models.list.return_value = [MagicMock()]
            mock_openai_class.return_value = mock_client

            success, _ = check_llm_connection(config)

            assert success is True
            mock_openai_class.assert_called_once_with(base_url="https://proxy.internal/v1", api_key="sk-test-api-key")

    def test_openrouter_exception_returns_failure(self):
        """API exception should return False with error message."""
        config = ProviderConfig(provider=LLMProvider.OPENROUTER, api_key="invalid")
        with patch("openai.OpenAI") as mock_class:
            mock_class.return_value.models.list.side_effect = Exception("Invalid API key")

            success, message = check_llm_connection(config)

            assert success is False
            assert "Invalid API key" in message

    def test_moonshot_connection_uses_the_default_endpoint(self):
        config = ProviderConfig(provider=LLMProvider.MOONSHOT, api_key="sk-test-api-key")
        with patch("openai.OpenAI") as mock_openai_class:
            mock_client = MagicMock()
            mock_client.models.list.return_value = [SimpleNamespace(id="kimi-k3")]
            mock_openai_class.return_value = mock_client

            success, message = check_llm_connection(config)

            assert success is True
            assert "1 models available" in message
            mock_openai_class.assert_called_once_with(api_key="sk-test-api-key", base_url="https://api.moonshot.ai/v1")

    def test_qwen_connection_uses_the_default_endpoint(self):
        config = ProviderConfig(provider=LLMProvider.QWEN, api_key="sk-test-api-key")
        with patch("openai.OpenAI") as mock_openai_class:
            mock_client = MagicMock()
            mock_client.models.list.return_value = [SimpleNamespace(id="qwen3.7-plus")]
            mock_openai_class.return_value = mock_client

            success, _ = check_llm_connection(config)

            assert success is True
            mock_openai_class.assert_called_once_with(
                api_key="sk-test-api-key",
                base_url="https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
            )

    def test_minimax_falls_back_to_a_probe_completion_without_a_model_list(self):
        """MiniMax answers GET /v1/models with a 404, so credentials are checked with a completion."""
        config = ProviderConfig(
            provider=LLMProvider.MINIMAX,
            api_key="sk-test-api-key",
            models=[ModelConfig(id="MiniMax-M3")],
        )
        with patch("openai.OpenAI") as mock_openai_class:
            mock_client = MagicMock()
            mock_client.models.list.side_effect = Exception("404 page not found")
            mock_openai_class.return_value = mock_client

            success, message = check_llm_connection(config)

            assert success is True
            assert "verified 'MiniMax-M3' with a test completion" in message
            mock_client.chat.completions.create.assert_called_once_with(
                model="MiniMax-M3",
                messages=[{"role": "user", "content": "ping"}],
                max_tokens=1,
            )

    def test_minimax_without_models_reports_that_one_is_needed(self):
        config = ProviderConfig(provider=LLMProvider.MINIMAX, api_key="sk-test-api-key")
        with patch("openai.OpenAI") as mock_openai_class:
            mock_client = MagicMock()
            mock_client.models.list.side_effect = Exception("404 page not found")
            mock_openai_class.return_value = mock_client

            success, message = check_llm_connection(config)

            assert success is False
            assert "declare a model" in message
            mock_client.chat.completions.create.assert_not_called()

    def test_openai_not_found_is_not_retried_as_a_completion(self):
        """Only the providers with no model list fall back to a probe, so a wrong endpoint stays visible."""
        config = ProviderConfig(
            provider=LLMProvider.OPENAI,
            api_key="sk-test-api-key",
            base_url="https://proxy.internal/wrong",
            models=[ModelConfig(id="gpt-4.1")],
        )
        with patch("openai.OpenAI") as mock_openai_class:
            mock_client = MagicMock()
            mock_client.models.list.side_effect = Exception("404 page not found")
            mock_openai_class.return_value = mock_client

            success, message = check_llm_connection(config)

            assert success is False
            assert "404 page not found" in message
            mock_client.chat.completions.create.assert_not_called()

    def test_openai_compatible_endpoint_is_reached_without_a_key(self):
        """A self-hosted endpoint declares its own URL and often needs no authentication."""
        config = ProviderConfig(provider=LLMProvider.OPENAI_COMPATIBLE, base_url="http://localhost:8000/v1")
        with patch("openai.OpenAI") as mock_openai_class:
            mock_client = MagicMock()
            mock_client.models.list.return_value = [SimpleNamespace(id="my-model")]
            mock_openai_class.return_value = mock_client

            success, message = check_llm_connection(config)

            assert success is True
            assert "1 models available" in message
            mock_openai_class.assert_called_once_with(api_key="no-key", base_url="http://localhost:8000/v1")

    def test_qwen_auth_failure_is_not_retried_as_a_completion(self):
        config = ProviderConfig(
            provider=LLMProvider.QWEN,
            api_key="invalid",
            models=[ModelConfig(id="qwen3.7-plus")],
        )
        with patch("openai.OpenAI") as mock_openai_class:
            mock_client = MagicMock()
            mock_client.models.list.side_effect = Exception("Unauthorized")
            mock_openai_class.return_value = mock_client

            success, message = check_llm_connection(config)

            assert success is False
            assert "Authentication failed" in message
            mock_client.chat.completions.create.assert_not_called()

    def test_ollama_connection_success(self):
        config = ProviderConfig(provider=LLMProvider.OLLAMA)

        with patch("ollama.list") as mock_list:
            mock_list.return_value.models = [MagicMock(), MagicMock(), MagicMock()]

            success, message = check_llm_connection(config)

            assert success is True
            assert "Connected successfully" in message
            assert "3 models available" in message
            mock_list.assert_called_once_with()

    def test_ollama_exception_returns_failure(self):
        """API exception should return False with error message."""
        config = ProviderConfig(provider=LLMProvider.OLLAMA)

        with patch("ollama.list") as mock_list:
            mock_list.side_effect = Exception("Connection refused")

            success, message = check_llm_connection(config)

            assert success is False
            assert "Connection refused" in message

    def test_bedrock_bearer_token_success(self):
        """A configured bearer token short-circuits without calling AWS."""
        config = ProviderConfig(provider=LLMProvider.BEDROCK, api_key="bearer-token", aws_region="us-west-2")

        success, message = check_llm_connection(config)

        assert success is True
        assert "Bearer token configured" in message
        assert "us-west-2" in message

    def test_bedrock_connection_success(self):
        config = ProviderConfig(provider=LLMProvider.BEDROCK, aws_region="us-east-1")

        with patch("boto3.Session") as mock_session_class:
            mock_client = MagicMock()
            mock_client.list_foundation_models.return_value = {
                "modelSummaries": [MagicMock(), MagicMock(), MagicMock()]
            }
            mock_session_class.return_value.client.return_value = mock_client

            success, message = check_llm_connection(config)

            assert success is True
            assert "Connected successfully" in message
            assert "3 models available" in message
            mock_session_class.return_value.client.assert_called_once_with("bedrock")
            mock_client.list_foundation_models.assert_called_once_with()

    def test_bedrock_exception_returns_failure(self):
        """API exception should return False with error message."""
        config = ProviderConfig(provider=LLMProvider.BEDROCK, aws_region="us-east-1")

        with patch("boto3.Session") as mock_session_class:
            mock_session_class.return_value.client.return_value.list_foundation_models.side_effect = Exception(
                "Could not connect to the endpoint URL"
            )

            success, message = check_llm_connection(config)

            assert success is False
            assert "Could not connect to the endpoint URL" in message

    def test_vertex_service_account_json_success(self):
        config = ProviderConfig(
            provider=LLMProvider.VERTEX,
            gcp_project="my-project",
            gcp_location="us-east5",
            service_account_json='{"type": "service_account"}',
        )

        with patch("google.oauth2.service_account.Credentials.from_service_account_info") as mock_creds:
            success, message = check_llm_connection(config)

            assert success is True
            assert "Service account configured" in message
            assert "my-project" in message
            mock_creds.assert_called_once_with(
                {"type": "service_account"},
                scopes=["https://www.googleapis.com/auth/cloud-platform"],
            )

    def test_vertex_key_file_success(self):
        config = ProviderConfig(
            provider=LLMProvider.VERTEX,
            gcp_project="my-project",
            key_file="/path/to/key.json",
        )

        with patch("google.oauth2.service_account.Credentials.from_service_account_file") as mock_creds:
            success, message = check_llm_connection(config)

            assert success is True
            assert "Key file configured" in message
            assert "my-project" in message
            mock_creds.assert_called_once_with(
                "/path/to/key.json",
                scopes=["https://www.googleapis.com/auth/cloud-platform"],
            )

    def test_vertex_adc_success(self):
        config = ProviderConfig(provider=LLMProvider.VERTEX, gcp_project="my-project")

        with patch("google.auth.default", return_value=(MagicMock(), "my-project")) as mock_default:
            success, message = check_llm_connection(config)

            assert success is True
            assert "ADC configured" in message
            assert "my-project" in message
            mock_default.assert_called_once_with(
                scopes=["https://www.googleapis.com/auth/cloud-platform"],
            )

    def test_vertex_missing_project_returns_failure(self):
        """Vertex without a gcp_project should return False."""
        config = ProviderConfig(provider=LLMProvider.VERTEX)

        success, message = check_llm_connection(config)

        assert success is False
        assert "gcp_project is not set" in message

    def test_unknown_provider_returns_failure(self):
        """Unknown provider should return False with error message."""
        config = MagicMock()
        config.provider.value = "super big model"

        success, message = check_llm_connection(config)

        assert success is False
        assert "Unknown provider" in message
        assert "super big model" in message


class TestDatabaseConnection:
    """Tests for check_connection method on database configs."""

    def test_bigquery_connection_with_dataset(self):
        config = BigQueryConfig(name="test", project_id="my-project", dataset_id="my_dataset")
        mock_conn = MagicMock()
        mock_conn.list_tables.return_value = ["table1", "table2"]

        with patch.object(BigQueryConfig, "connect", return_value=mock_conn):
            success, message = config.check_connection()

        assert success is True
        assert "2 tables found" in message

    def test_bigquery_connection_with_schemas(self):
        config = BigQueryConfig(name="test", project_id="my-project")
        mock_conn = MagicMock()
        mock_conn.list_databases.return_value = ["schema1", "schema2", "schema3"]

        with patch.object(BigQueryConfig, "connect", return_value=mock_conn):
            success, message = config.check_connection()

        assert success is True
        assert "3 datasets found" in message

    def test_duckdb_connection_with_tables(self):
        config = DuckDBConfig(name="test", path=":memory:")
        mock_conn = MagicMock()
        mock_conn.list_tables.return_value = ["table1", "table2"]

        with patch.object(DuckDBConfig, "connect", return_value=mock_conn):
            success, message = config.check_connection()

        assert success is True
        assert "2 tables found" in message

    def test_postgres_connection_fallback(self):
        config = PostgresConfig(
            name="test", host="localhost", port=5432, database="testdb", user="user", password="pass"
        )
        mock_conn = MagicMock(spec=["disconnect"])  # no list_databases

        with patch.object(PostgresConfig, "connect", return_value=mock_conn):
            success, message = config.check_connection()

        assert success is True
        assert "Connected successfully" in message

    def test_trino_connection_with_default_schema(self):
        config = TrinoConfig(
            name="test",
            host="localhost",
            port=8080,
            catalog="hive",
            user="nao",
            schema_name="analytics",
        )
        mock_conn = MagicMock()
        mock_conn.list_tables.return_value = ["table1", "table2"]

        with patch.object(TrinoConfig, "connect", return_value=mock_conn):
            success, message = config.check_connection()

        assert success is True
        assert "2 tables found" in message

    def test_trino_get_schemas_filters_builtins_and_nullish_values(self):
        config = TrinoConfig(name="test", host="localhost", port=8080, catalog="hive", user="nao")
        mock_conn = MagicMock()
        mock_result = MagicMock()
        mock_result.fetchall.return_value = [
            ("information_schema",),
            ("default",),
            ("sys",),
            ("pg_catalog",),
            (" pg_internal ",),
            (" public ",),
            ('"analytics"',),
            ("'sales'",),
            ("analytics",),
            ("",),
            (None,),
        ]
        mock_conn.raw_sql.return_value = mock_result

        schemas = config.get_schemas(mock_conn)

        assert schemas == ["analytics", "public", "sales"]

    @pytest.mark.parametrize(
        ("include", "expected"),
        [
            ([], ["default", "analytics"]),
            (["system.*"], ["default", "analytics", "system"]),
        ],
    )
    def test_clickhouse_get_schemas_system_filtering(self, include, expected):
        config = ClickHouseConfig(
            name="test",
            host="localhost",
            database="default",
            user="default",
            password="",
            include=include,
        )
        mock_conn = MagicMock()
        mock_conn.list_databases.return_value = [
            "default",
            "analytics",
            "system",
            "INFORMATION_SCHEMA",
            "information_schema",
        ]

        schemas = config.get_schemas(mock_conn)

        assert schemas == expected

    def test_connection_failure(self):
        config = DuckDBConfig(name="test", path=":memory:")

        with patch.object(DuckDBConfig, "connect", side_effect=Exception("Connection refused")):
            success, message = config.check_connection()

        assert success is False
        assert "Connection refused" in message


@pytest.mark.usefixtures("clean_env")
class TestDebugCommand:
    """Tests for the debug() command."""

    def test_exits_when_no_config_found(self, tmp_path, monkeypatch):
        monkeypatch.chdir(tmp_path)

        with patch("nao_core.commands.debug.console"):
            with pytest.raises(SystemExit) as exc_info:
                debug()

            assert exc_info.value.code == 1

    def test_debug_with_databases(self, create_config):
        """Test debug() when databases are configured."""
        create_config("""\
project_name: test-project
databases:
  - name: test_db
    type: postgres
    host: localhost
    port: 5432
    database: testdb
    user: testuser
    password: pass
""")

        with patch(
            "nao_core.config.databases.postgres.PostgresConfig.check_connection",
            return_value=(True, "Connected (5 tables found)"),
        ):
            with patch("nao_core.commands.debug.console") as mock_console:
                debug()

        # Convert each mock call to string representation, e.g.:
        # call("[bold green]✓[/bold green] Loaded config: [cyan]test-project[/cyan]\n")
        # Then check if expected substrings appear in any of the calls
        calls = [str(call) for call in mock_console.print.call_args_list]
        assert any("test_db" in call for call in calls)
        assert any("test-project" in call for call in calls)

    def test_debug_with_databases_error(self, create_config):
        """Test debug() when databases are configured but not working."""
        create_config("""\
project_name: test-project
databases:
  - name: test_db
    type: postgres
    host: localhost
    port: 0000
    database: testdb
    user: testuser
    password: pass
""")

        with patch(
            "nao_core.config.databases.postgres.PostgresConfig.check_connection",
            return_value=(False, "Failed DB connection"),
        ) as mock_check:
            with patch("nao_core.commands.debug.console") as mock_console:
                debug()

        calls = [str(call) for call in mock_console.print.call_args_list]
        assert any("[bold red]✗[/bold red]" in call for call in calls)

        mock_check.assert_called_once()

    def test_debug_with_databases_empty(self, create_config):
        """Test debug() when no databases."""
        create_config()
        with patch("nao_core.commands.debug.console") as mock_console:
            debug()

        calls = [str(call) for call in mock_console.print.call_args_list]
        assert any("[dim]No databases configured[/dim]" in call for call in calls)

    def test_debug_with_llm(self, create_config):
        """Test debug() when LLM is configured."""
        create_config("""\
project_name: test-project
llm:
  provider: anthropic
  api_key: sk-test-key
""")

        with patch(
            "nao_core.commands.debug.check_llm_connection",
            return_value=(True, "Connected successfully (42 models available"),
        ) as mock_check:
            with patch("nao_core.commands.debug.console") as mock_console:
                debug()

        calls = [str(call) for call in mock_console.print.call_args_list]
        assert any("anthropic" in call for call in calls)
        assert any("[bold green]✓[/bold green]" in call for call in calls)

        mock_check.assert_called_once()

    def test_debug_warns_on_missing_configured_models(self, create_config):
        create_config("""\
project_name: test-project
llm:
  providers:
    - provider: openai
      api_key: sk-test-key
      models:
        - id: gpt-missing
""")

        with patch(
            "nao_core.commands.debug.check_llm_connection",
            return_value=(
                True,
                "Connected successfully (2 models available). Warning: configured model(s) not in provider list: gpt-missing",
            ),
        ) as mock_check:
            with patch("nao_core.commands.debug.console") as mock_console:
                debug()

        calls = [str(call) for call in mock_console.print.call_args_list]
        assert any("[bold yellow]⚠[/bold yellow]" in call for call in calls)
        assert any("gpt-missing" in call for call in calls)
        mock_check.assert_called_once()

    def test_debug_with_llm_error(self, create_config):
        """Test debug() when LLM is configured."""
        create_config("""\
project_name: test-project
llm:
  provider: anthropic
  api_key: sk-test-key
""")

        with patch(
            "nao_core.commands.debug.check_llm_connection", return_value=(False, "API key is not working")
        ) as mock_check:
            with patch("nao_core.commands.debug.console") as mock_console:
                debug()

        calls = [str(call) for call in mock_console.print.call_args_list]
        assert any("anthropic" in call for call in calls)
        assert any("[bold red]✗[/bold red]" in call for call in calls)

        mock_check.assert_called_once()

    def test_debug_preserves_provider_extra_in_missing_dependency_message(self, create_config):
        """MissingDependencyError pip extras like [anthropic] must survive Rich table rendering."""
        from io import StringIO

        from rich.console import Console

        from nao_core.deps import MissingDependencyError

        create_config("""\
project_name: test-project
llm:
  provider: anthropic
  api_key: sk-test-key
""")

        missing_message = str(MissingDependencyError("anthropic", "anthropic", "for Anthropic LLM provider"))
        assert "pip install 'nao-core[anthropic]'" in missing_message

        buffer = StringIO()
        real_console = Console(file=buffer, force_terminal=True, width=200, color_system=None)

        with patch(
            "nao_core.commands.debug.check_llm_connection",
            return_value=(False, missing_message),
        ):
            with patch("nao_core.commands.debug.console", real_console):
                debug()

        output = buffer.getvalue()
        assert "pip install 'nao-core[anthropic]'" in output
        assert "uv pip install 'nao-core[anthropic]'" in output
