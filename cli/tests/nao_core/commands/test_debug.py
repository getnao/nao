from unittest.mock import MagicMock, patch

import pytest

from nao_core.commands.debug import check_database_connection, check_llm_connection, debug
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
    """Tests for check_database_connection."""

    def test_connection_with_tables(self):
        mock_db = MagicMock()
        mock_db.dataset_id = "my_dataset"
        mock_conn = MagicMock()
        mock_conn.list_tables.return_value = ["table1", "table2"]
        mock_db.connect.return_value = mock_conn

        success, message = check_database_connection(mock_db)

        assert success is True
        assert "2 tables found" in message

    def test_connection_with_schemas(self):
        mock_db = MagicMock(spec=["connect", "name", "type"])  # no dataset_id
        mock_conn = MagicMock()
        mock_conn.list_databases.return_value = ["schema1", "schema2", "schema3"]
        mock_db.connect.return_value = mock_conn

        success, message = check_database_connection(mock_db)

        assert success is True
        assert "3 schemas found" in message

    def test_connection_fallback(self):
        mock_db = MagicMock(spec=["connect", "name", "type"])  # no dataset_id
        mock_conn = MagicMock(spec=[])  # no list_tables or list_databases
        mock_db.connect.return_value = mock_conn

        success, message = check_database_connection(mock_db)

        assert success is True
        assert "unable to list" in message

    def test_connection_failure(self):
        mock_db = MagicMock()
        mock_db.connect.side_effect = Exception("Connection refused")

        success, message = check_database_connection(mock_db)

        assert success is False
        assert "Connection refused" in message


class TestDebugCommand:
    """Tests for the debug() command."""

    def test_exits_when_no_config_found(self, tmp_path, monkeypatch):
        monkeypatch.chdir(tmp_path)
        monkeypatch.delenv("NAO_DEFAULT_PROJECT_PATH", raising=False)

        with patch("nao_core.commands.debug.console"):
            with pytest.raises(SystemExit) as exc_info:
                debug()

            assert exc_info.value.code == 1

    def test_debug_with_databases(self, tmp_path, monkeypatch):
        """Test debug() when databases are configured."""
        config_file = tmp_path / "nao_config.yaml"
        config_file.write_text("""\
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
        monkeypatch.chdir(tmp_path)
        monkeypatch.delenv("NAO_DEFAULT_PROJECT_PATH", raising=False)

        with patch(
            "nao_core.commands.debug.check_database_connection", return_value=(True, "Connected (5 tables found)")
        ):
            with patch("nao_core.commands.debug.console") as mock_console:
                debug()

        # Convert each mock call to string representation, e.g.:
        # call("[bold green]✓[/bold green] Loaded config: [cyan]test-project[/cyan]\n")
        # Then check if expected substrings appear in any of the calls
        calls = [str(call) for call in mock_console.print.call_args_list]
        assert any("test_db" in call for call in calls)
        assert any("test-project" in call for call in calls)

    def test_debug_with_databases_error(self, tmp_path, monkeypatch):
        """Test debug() when databases are configured but not working."""
        config_file = tmp_path / "nao_config.yaml"
        config_file.write_text("""\
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
        monkeypatch.chdir(tmp_path)
        monkeypatch.delenv("NAO_DEFAULT_PROJECT_PATH", raising=False)

        with patch(
            "nao_core.commands.debug.check_database_connection", return_value=(False, "Failed DB connection")
        ) as mock_check:
            with patch("nao_core.commands.debug.console") as mock_console:
                debug()

        calls = [str(call) for call in mock_console.print.call_args_list]
        assert any("[bold red]✗[/bold red]" in call for call in calls)

        mock_check.assert_called_once()

    def test_debug_with_databases_empty(self, tmp_path, monkeypatch):
        """Test debug() when no databases."""
        config_file = tmp_path / "nao_config.yaml"
        config_file.write_text("project_name: test-project")
        monkeypatch.chdir(tmp_path)
        monkeypatch.delenv("NAO_DEFAULT_PROJECT_PATH", raising=False)

        with patch("nao_core.commands.debug.console") as mock_console:
            debug()

        calls = [str(call) for call in mock_console.print.call_args_list]
        assert any("[dim]No databases configured[/dim]" in call for call in calls)

    def test_debug_with_llm(self, tmp_path, monkeypatch):
        """Test debug() when LLM is configured."""
        config_file = tmp_path / "nao_config.yaml"
        # Note: api_key is required per LLMConfig schema
        config_file.write_text("""\
project_name: test-project
llm:
  provider: anthropic
  api_key: sk-test-key
""")
        monkeypatch.chdir(tmp_path)
        monkeypatch.delenv("NAO_DEFAULT_PROJECT_PATH", raising=False)

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

    def test_debug_with_llm_error(self, tmp_path, monkeypatch):
        """Test debug() when LLM is configured."""
        config_file = tmp_path / "nao_config.yaml"
        # Note: api_key is required per LLMConfig schema
        config_file.write_text("""\
project_name: test-project
llm:
  provider: anthropic
  api_key: sk-test-key
""")
        monkeypatch.chdir(tmp_path)
        monkeypatch.delenv("NAO_DEFAULT_PROJECT_PATH", raising=False)

        with patch(
            "nao_core.commands.debug.check_llm_connection", return_value=(False, "API key is not working")
        ) as mock_check:
            with patch("nao_core.commands.debug.console") as mock_console:
                debug()

        calls = [str(call) for call in mock_console.print.call_args_list]
        assert any("anthropic" in call for call in calls)
        assert any("[bold red]✗[/bold red]" in call for call in calls)

        mock_check.assert_called_once()
