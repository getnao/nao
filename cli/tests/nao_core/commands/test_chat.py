from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

from nao_core.commands.chat import (
    chat,
    ensure_auth_secret,
    get_fastapi_main_path,
    get_server_binary_path,
    wait_for_server,
)
from nao_core.config.base import NaoConfig, NaoConfigError

# Tests for try_load with exit_on_error=False (default, silent mode)


SERVER_PORT = 8080
TIMEOUT = 1


def test_try_load_returns_none_when_file_not_found(tmp_path: Path):
    cfg = NaoConfig.try_load(tmp_path)
    assert cfg is None


def test_try_load_returns_none_when_invalid_yaml(tmp_path: Path):
    invalid_yaml = tmp_path / "nao_config.yaml"
    invalid_yaml.write_text("project_name: [invalid yaml")  # Invalid YAML syntax

    cfg = NaoConfig.try_load(tmp_path)
    assert cfg is None


def test_try_load_returns_none_when_validation_error(tmp_path: Path):
    invalid_config = tmp_path / "nao_config.yaml"
    invalid_config.write_text("databases: []")  # Missing required project_name

    cfg = NaoConfig.try_load(tmp_path)
    assert cfg is None


def test_try_load_returns_config_when_valid(tmp_path: Path):
    valid_yaml = tmp_path / "nao_config.yaml"
    valid_yaml.write_text("project_name: test-project")

    cfg = NaoConfig.try_load(tmp_path)

    assert cfg is not None
    assert isinstance(cfg, NaoConfig)
    assert cfg.project_name == "test-project"


# Tests for try_load with exit_on_error=True


def test_try_load_exits_on_file_not_found(tmp_path: Path):
    with patch("nao_core.config.base.Console") as mock_console_cls:
        mock_console = mock_console_cls.return_value
        with pytest.raises(SystemExit) as exc_info:
            NaoConfig.try_load(tmp_path, exit_on_error=True)

        assert exc_info.value.code == 1
        mock_console.print.assert_any_call("[bold red]✗[/bold red] No nao_config.yaml found in current directory")


def test_try_load_exits_on_invalid_yaml(tmp_path: Path):
    invalid_yaml = tmp_path / "nao_config.yaml"
    invalid_yaml.write_text("project_name: [invalid yaml")

    with patch("nao_core.config.base.Console") as mock_console_cls:
        mock_console = mock_console_cls.return_value
        with pytest.raises(SystemExit) as exc_info:
            NaoConfig.try_load(tmp_path, exit_on_error=True)

        assert exc_info.value.code == 1
        assert mock_console.print.call_count == 1
        call_args = str(mock_console.print.call_args)
        assert "Failed to load nao_config.yaml" in call_args
        assert "Invalid YAML syntax" in call_args


def test_try_load_exits_on_validation_error(tmp_path: Path):
    invalid_config = tmp_path / "nao_config.yaml"
    invalid_config.write_text("databases: []")  # Missing required project_name

    with patch("nao_core.config.base.Console") as mock_console_cls:
        mock_console = mock_console_cls.return_value
        with pytest.raises(SystemExit) as exc_info:
            NaoConfig.try_load(tmp_path, exit_on_error=True)

        assert exc_info.value.code == 1
        assert mock_console.print.call_count == 1
        call_args = str(mock_console.print.call_args)
        assert "Failed to load nao_config.yaml" in call_args


# Tests for try_load with raise_on_error=True


def test_try_load_raises_on_file_not_found(tmp_path: Path):
    with pytest.raises(NaoConfigError) as exc_info:
        NaoConfig.try_load(tmp_path, raise_on_error=True)

    assert "No nao_config.yaml found" in str(exc_info.value)


def test_try_load_raises_on_invalid_yaml(tmp_path: Path):
    invalid_yaml = tmp_path / "nao_config.yaml"
    invalid_yaml.write_text("project_name: [invalid yaml")

    with pytest.raises(NaoConfigError) as exc_info:
        NaoConfig.try_load(tmp_path, raise_on_error=True)

    assert "Invalid YAML syntax" in str(exc_info.value)


def test_try_load_raises_on_validation_error(tmp_path: Path):
    invalid_config = tmp_path / "nao_config.yaml"
    invalid_config.write_text("databases: []")  # Missing required project_name

    with pytest.raises(NaoConfigError) as exc_info:
        NaoConfig.try_load(tmp_path, raise_on_error=True)

    assert "Failed to load nao_config.yaml" in str(exc_info.value)


# Integration test for chat command


def test_chat_exits_when_no_config_found(tmp_path: Path, monkeypatch, clean_env):
    monkeypatch.chdir(tmp_path)

    with patch("nao_core.config.base.Console"):
        with pytest.raises(SystemExit) as exc_info:
            chat()

        assert exc_info.value.code == 1


def test_get_server_binary_path():
    """Test that get_server_binary_path returns the expected path structure."""
    with patch.object(Path, "exists", return_value=True):
        result_path = get_server_binary_path()

    assert result_path.name == "nao-chat-server"
    assert result_path.parent.name == "bin"


def test_get_server_binary_path_does_not_exists():
    """Exit when the server binary does not exist."""
    with patch("nao_core.commands.chat.Path.exists", return_value=False):
        with pytest.raises(SystemExit) as exc_info:
            get_server_binary_path()

    assert exc_info.value.code == 1
    assert exc_info.type is SystemExit


def test_get_fastapi_main_path():
    """Test that get_fastapi_main_path returns the expected path structure."""
    with patch.object(Path, "exists", return_value=True):
        result_path = get_fastapi_main_path()

    assert result_path.name == "main.py"
    assert result_path.parent.name == "fastapi"


def test_get_fastapi_main_path_does_not_exists():
    """Exit when the FastAPI main.py does not exist."""
    with patch("nao_core.commands.chat.Path.exists", return_value=False):
        with pytest.raises(SystemExit) as exc_info:
            get_fastapi_main_path()

    assert exc_info.value.code == 1
    assert exc_info.type is SystemExit


class TestWaitForServer:
    def test_wait_for_server_returns_true_when_server_is_ready(self, mock_socket):
        """Test that wait_for_server returns True when server is immediately available."""
        mock_socket.connect_ex.return_value = 0
        assert wait_for_server(SERVER_PORT, timeout=TIMEOUT) is True

    def test_wait_for_server_returns_false_on_timeout(self, mock_socket):
        """Test that wait_for_server returns False when server never becomes available."""
        mock_socket.connect_ex.return_value = 111
        assert wait_for_server(SERVER_PORT, timeout=TIMEOUT) is False

    def test_wait_for_server_retries_until_success(self, mock_socket):
        """Test that wait_for_server retries and succeeds eventually."""
        mock_socket.connect_ex.side_effect = [111, 111, 111, 0]
        assert wait_for_server(SERVER_PORT, timeout=TIMEOUT) is True
        assert mock_socket.connect_ex.call_count == 4

    def test_wait_for_server_handles_os_error(self, mock_socket):
        """Test that wait_for_server handles OSError gracefully."""
        mock_socket.connect_ex.side_effect = OSError("Network error")
        assert wait_for_server(SERVER_PORT, timeout=TIMEOUT) is False


@pytest.mark.usefixtures("clean_env")
class TestEnsureAuthSecret:
    def test_returns_none_when_env_var_already_set(self, tmp_path: Path, monkeypatch):
        """Test that ensure_auth_secret returns None when BETTER_AUTH_SECRET is set."""
        monkeypatch.setenv("BETTER_AUTH_SECRET", "existing-secret")

        with patch("nao_core.commands.chat.console"):
            result = ensure_auth_secret(tmp_path)

        assert result is None

    def test_loads_existing_secret_from_file(self, tmp_path: Path):
        """Test that ensure_auth_secret loads secret from existing file."""
        secret_file = tmp_path / ".nao-secret"
        secret_file.write_text("my-saved-secret")

        with patch("nao_core.commands.chat.console"):
            result = ensure_auth_secret(tmp_path)

        assert result == "my-saved-secret"

    def test_generates_new_secret_when_file_missing(self, tmp_path: Path):
        """Test that ensure_auth_secret generates a new secret when file doesn't exist."""
        with patch("nao_core.commands.chat.console"):
            result = ensure_auth_secret(tmp_path)

        assert result is not None
        assert len(result) > 20  # URL-safe base64 of 32 bytes
        # Verify file was created
        secret_file = tmp_path / ".nao-secret"
        assert secret_file.exists()
        assert secret_file.read_text() == result

    def test_generates_new_secret_when_file_empty(self, tmp_path: Path):
        """Test that ensure_auth_secret generates a new secret when file is empty."""
        secret_file = tmp_path / ".nao-secret"
        secret_file.write_text("")

        with patch("nao_core.commands.chat.console"):
            result = ensure_auth_secret(tmp_path)

        assert result is not None
        assert len(result) > 20

    def test_handles_file_write_error(self, tmp_path: Path):
        """Test that ensure_auth_secret handles file write errors gracefully."""
        with patch("nao_core.commands.chat.console"):
            with patch.object(Path, "write_text", side_effect=PermissionError("Cannot write")):
                result = ensure_auth_secret(tmp_path)

        # Should still return a secret even if it can't be saved
        assert result is not None
        assert len(result) > 20


class TestChatCommand:
    """
    Tests for the chat() command using mocked subprocess calls.

    We mock subprocess.Popen to avoid actually starting servers.
    This lets us test the orchestration logic (env vars, error handling, etc.)
    without needing the built server binary.
    """

    @patch("nao_core.commands.chat.webbrowser.open")
    @patch("nao_core.commands.chat.wait_for_server")
    @patch("nao_core.commands.chat.subprocess.Popen")
    @patch("nao_core.commands.chat.get_fastapi_main_path")
    @patch("nao_core.commands.chat.get_server_binary_path")
    @patch("nao_core.commands.chat.console")
    def test_chat_starts_both_servers(
        self,
        mock_console,
        mock_binary_path,
        mock_fastapi_path,
        mock_popen,  # Mocked so we don't actually spawn processes
        mock_wait_for_server,
        mock_webbrowser,
        mock_chat_dependencies,
    ):
        """Verify that chat() starts both FastAPI and chat servers."""
        tmp_path, bin_dir = mock_chat_dependencies

        mock_binary_path.return_value = bin_dir / "nao-chat-server"
        mock_fastapi_path.return_value = bin_dir / "fastapi" / "main.py"
        mock_wait_for_server.return_value = True  # Pretend servers started OK

        # Mock a process that exits immediately (empty stdout ends the loop)
        mock_process = MagicMock()
        mock_process.stdout = iter([])
        mock_process.wait.return_value = 0
        mock_popen.return_value = mock_process

        chat()

        # Popen called twice: once for FastAPI, once for chat server
        assert mock_popen.call_count == 2
        mock_webbrowser.assert_called_once()
        assert "localhost" in str(mock_webbrowser.call_args)

    @patch("nao_core.commands.chat.webbrowser.open")
    @patch("nao_core.commands.chat.wait_for_server")
    @patch("nao_core.commands.chat.subprocess.Popen")
    @patch("nao_core.commands.chat.get_fastapi_main_path")
    @patch("nao_core.commands.chat.get_server_binary_path")
    @patch("nao_core.commands.chat.console")
    def test_chat_sets_environment_variables(
        self,
        mock_console,
        mock_binary_path,
        mock_fastapi_path,
        mock_popen,
        mock_wait_for_server,
        mock_webbrowser,
        mock_chat_dependencies,
    ):
        """Verify that chat() sets required environment variables."""
        tmp_path, bin_dir = mock_chat_dependencies

        mock_binary_path.return_value = bin_dir / "nao-chat-server"
        mock_fastapi_path.return_value = bin_dir / "fastapi" / "main.py"
        mock_wait_for_server.return_value = True

        mock_process = MagicMock()
        mock_process.stdout = iter([])
        mock_popen.return_value = mock_process

        chat()

        chat_server_call = mock_popen.call_args_list[1]
        env = chat_server_call.kwargs.get("env", {})

        assert "NAO_DEFAULT_PROJECT_PATH" in env
        assert "BETTER_AUTH_SECRET" in env

    @patch("nao_core.commands.chat.webbrowser.open")
    @patch("nao_core.commands.chat.wait_for_server")
    @patch("nao_core.commands.chat.subprocess.Popen")
    @patch("nao_core.commands.chat.get_fastapi_main_path")
    @patch("nao_core.commands.chat.get_server_binary_path")
    @patch("nao_core.commands.chat.console")
    def test_chat_handles_keyboard_interrupt(
        self,
        mock_console,
        mock_binary_path,
        mock_fastapi_path,
        mock_popen,
        mock_wait_for_server,
        mock_webbrowser,
        mock_chat_dependencies,
    ):
        """Verify graceful shutdown on Ctrl+C."""
        tmp_path, bin_dir = mock_chat_dependencies

        mock_binary_path.return_value = bin_dir / "nao-chat-server"
        mock_fastapi_path.return_value = bin_dir / "fastapi" / "main.py"
        mock_wait_for_server.return_value = True

        mock_process = MagicMock()
        mock_process.stdout.__iter__ = MagicMock(side_effect=KeyboardInterrupt)
        mock_popen.return_value = mock_process

        with pytest.raises(SystemExit) as exc_info:
            chat()

        assert exc_info.value.code == 0
        mock_process.terminate.assert_called()

    @patch("nao_core.commands.chat.webbrowser.open")
    @patch("nao_core.commands.chat.wait_for_server")
    @patch("nao_core.commands.chat.subprocess.Popen")
    @patch("nao_core.commands.chat.get_fastapi_main_path")
    @patch("nao_core.commands.chat.get_server_binary_path")
    @patch("nao_core.commands.chat.console")
    def test_chat_handles_server_crash(
        self,
        mock_console,
        mock_binary_path,
        mock_fastapi_path,
        mock_popen,
        mock_wait_for_server,
        mock_webbrowser,
        mock_chat_dependencies,
    ):
        """Verify error handling when server startup fails."""
        tmp_path, bin_dir = mock_chat_dependencies

        mock_binary_path.return_value = bin_dir / "nao-chat-server"
        mock_fastapi_path.return_value = bin_dir / "fastapi" / "main.py"
        mock_popen.side_effect = OSError("Permission denied")

        with pytest.raises(SystemExit) as exc_info:
            chat()

        assert exc_info.value.code == 1

    @patch("nao_core.commands.chat.webbrowser.open")
    @patch("nao_core.commands.chat.wait_for_server")
    @patch("nao_core.commands.chat.subprocess.Popen")
    @patch("nao_core.commands.chat.get_fastapi_main_path")
    @patch("nao_core.commands.chat.get_server_binary_path")
    @patch("nao_core.commands.chat.console")
    def test_chat_waits_for_servers_before_opening_browser(
        self,
        mock_console,
        mock_binary_path,
        mock_fastapi_path,
        mock_popen,
        mock_wait_for_server,
        mock_webbrowser,
        mock_chat_dependencies,
    ):
        """Verify browser opens only after servers are ready."""
        tmp_path, bin_dir = mock_chat_dependencies

        mock_binary_path.return_value = bin_dir / "nao-chat-server"
        mock_fastapi_path.return_value = bin_dir / "fastapi" / "main.py"
        mock_wait_for_server.return_value = True

        mock_process = MagicMock()
        mock_process.stdout = iter([])
        mock_popen.return_value = mock_process

        chat()

        assert mock_wait_for_server.call_count == 2
        mock_webbrowser.assert_called_once()

    @patch("nao_core.commands.chat.webbrowser.open")
    @patch("nao_core.commands.chat.wait_for_server")
    @patch("nao_core.commands.chat.subprocess.Popen")
    @patch("nao_core.commands.chat.get_fastapi_main_path")
    @patch("nao_core.commands.chat.get_server_binary_path")
    @patch("nao_core.commands.chat.console")
    def test_chat_continues_even_if_server_slow_to_start(
        self,
        mock_console,
        mock_binary_path,
        mock_fastapi_path,
        mock_popen,
        mock_wait_for_server,
        mock_webbrowser,
        mock_chat_dependencies,
    ):
        """Verify chat warns user when server is slow to start."""
        tmp_path, bin_dir = mock_chat_dependencies

        mock_binary_path.return_value = bin_dir / "nao-chat-server"
        mock_fastapi_path.return_value = bin_dir / "fastapi" / "main.py"
        mock_wait_for_server.return_value = False  # Server timeout

        mock_process = MagicMock()
        mock_process.stdout = iter([])
        mock_popen.return_value = mock_process

        chat()

        mock_webbrowser.assert_not_called()
        calls = [str(c) for c in mock_console.print.call_args_list]
        assert any("taking longer than expected" in c for c in calls)

    @patch("nao_core.commands.chat.webbrowser.open")
    @patch("nao_core.commands.chat.wait_for_server")
    @patch("nao_core.commands.chat.subprocess.Popen")
    @patch("nao_core.commands.chat.get_fastapi_main_path")
    @patch("nao_core.commands.chat.get_server_binary_path")
    @patch("nao_core.commands.chat.console")
    def test_chat_sets_llm_api_key_from_config(
        self,
        mock_console,
        mock_binary_path,
        mock_fastapi_path,
        mock_popen,
        mock_wait_for_server,
        mock_webbrowser,
        tmp_path: Path,
        create_config,
        clean_env,
    ):
        """Verify LLM API key from config is passed to server env."""
        create_config("""\
project_name: test-project
llm:
  provider: openai
  api_key: sk-test-key-12345
""")

        bin_dir = tmp_path / "bin"
        bin_dir.mkdir()
        (bin_dir / "nao-chat-server").touch()
        fastapi_dir = bin_dir / "fastapi"
        fastapi_dir.mkdir()
        (fastapi_dir / "main.py").touch()

        mock_binary_path.return_value = bin_dir / "nao-chat-server"
        mock_fastapi_path.return_value = bin_dir / "fastapi" / "main.py"
        mock_wait_for_server.return_value = True

        mock_process = MagicMock()
        mock_process.stdout = iter([])
        mock_popen.return_value = mock_process

        chat()

        # Second Popen call is the chat server
        chat_server_call = mock_popen.call_args_list[1]
        env = chat_server_call.kwargs.get("env", {})
        assert env.get("OPENAI_API_KEY") == "sk-test-key-12345"

    @patch("nao_core.commands.chat.webbrowser.open")
    @patch("nao_core.commands.chat.wait_for_server")
    @patch("nao_core.commands.chat.subprocess.Popen")
    @patch("nao_core.commands.chat.get_fastapi_main_path")
    @patch("nao_core.commands.chat.get_server_binary_path")
    @patch("nao_core.commands.chat.console")
    def test_chat_sets_slack_config_from_config(
        self,
        mock_console,
        mock_binary_path,
        mock_fastapi_path,
        mock_popen,
        mock_wait_for_server,
        mock_webbrowser,
        tmp_path: Path,
        create_config,
        clean_env,
    ):
        """Verify Slack tokens from config are passed to server env."""
        create_config("""\
project_name: test-project
slack:
  bot_token: xoxb-test-token
  signing_secret: test-signing-secret
""")

        bin_dir = tmp_path / "bin"
        bin_dir.mkdir()
        (bin_dir / "nao-chat-server").touch()
        fastapi_dir = bin_dir / "fastapi"
        fastapi_dir.mkdir()
        (fastapi_dir / "main.py").touch()

        mock_binary_path.return_value = bin_dir / "nao-chat-server"
        mock_fastapi_path.return_value = bin_dir / "fastapi" / "main.py"
        mock_wait_for_server.return_value = True

        mock_process = MagicMock()
        mock_process.stdout = iter([])
        mock_popen.return_value = mock_process

        chat()

        # Second Popen call is the chat server
        chat_server_call = mock_popen.call_args_list[1]
        env = chat_server_call.kwargs.get("env", {})
        assert env.get("SLACK_BOT_TOKEN") == "xoxb-test-token"
        assert env.get("SLACK_SIGNING_SECRET") == "test-signing-secret"
