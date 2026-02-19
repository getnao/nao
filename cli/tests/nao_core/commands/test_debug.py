from unittest.mock import MagicMock, patch

import pytest

from nao_core.commands.debug import check_llm_connection, debug
from nao_core.config.databases import BigQueryConfig, DuckDBConfig, PostgresConfig
from nao_core.config.llm import LLMConfig, LLMProvider


class TestLLMConnection:
    """
    Tests for check_llm_connection.
    """

    def test_openai_connection_success(self):
        config = LLMConfig(provider=LLMProvider.OPENAI, api_key="sk-test-api-key")

        with patch("openai.OpenAI") as mock_openai_class:
            mock_client = MagicMock()
            mock_client.models.list.return_value = [MagicMock(), MagicMock(), MagicMock()]
            mock_openai_class.return_value = mock_client

            success, message = check_llm_connection(config)

            assert success is True
            assert "Connected successfully" in message
            assert "3 models available" in message
            mock_openai_class.assert_called_once_with(api_key="sk-test-api-key")

    def test_anthropic_connection_success(self):
        config = LLMConfig(provider=LLMProvider.ANTHROPIC, api_key="sk-test-api-key")

        with patch("anthropic.Anthropic") as mock_anthropic_class:
            mock_client = MagicMock()
            mock_client.models.list.return_value = [MagicMock(), MagicMock(), MagicMock()]
            mock_anthropic_class.return_value = mock_client

            success, message = check_llm_connection(config)

            assert success is True
            assert "Connected successfully" in message
            assert "3 models available" in message
            mock_anthropic_class.assert_called_once_with(api_key="sk-test-api-key")

    def test_unknown_provider_returns_failure(self):
        """Unknown provider should return False with error message."""
        config = MagicMock()
        config.provider.value = "super big model"

        success, message = check_llm_connection(config)

        assert success is False
        assert "Unknown provider" in message
        assert "super big model" in message

    def test_openai_exception_returns_failure(self):
        """API exception should return False with error message."""
        config = LLMConfig(provider=LLMProvider.OPENAI, api_key="invalid")

        with patch("openai.OpenAI") as mock_class:
            mock_class.return_value.models.list.side_effect = Exception("Invalid API key")

            success, message = check_llm_connection(config)

            assert success is False
            assert "Invalid API key" in message

    def test_anthropic_exception_returns_failure(self):
        """API exception should return False with error message."""
        config = LLMConfig(provider=LLMProvider.ANTHROPIC, api_key="invalid")

        with patch("anthropic.Anthropic") as mock_class:
            mock_class.return_value.models.list.side_effect = Exception("Authentication failed")

            success, message = check_llm_connection(config)

            assert success is False
            assert "Authentication failed" in message

    def test_gemini_connection_success(self):
        config = LLMConfig(provider=LLMProvider.GEMINI, api_key="test-gemini-key")

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
        config = LLMConfig(provider=LLMProvider.GEMINI, api_key="invalid")

        with patch("google.genai.Client") as mock_client_class:
            mock_client_class.return_value.models.list.side_effect = Exception("Invalid API key")

            success, message = check_llm_connection(config)

            assert success is False
            assert "Invalid API key" in message

    def test_mistral_connection_success(self):
        config = LLMConfig(provider=LLMProvider.MISTRAL, api_key="test-mistral-key")

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
        config = LLMConfig(provider=LLMProvider.MISTRAL, api_key="invalid")

        with patch("mistralai.Mistral") as mock_class:
            mock_class.return_value.models.list.side_effect = Exception("Unauthorized")

            success, message = check_llm_connection(config)

            assert success is False
            assert "Unauthorized" in message


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
