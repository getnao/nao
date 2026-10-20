from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest

from nao_core.commands.chat import (
    build_llm_env,
    chat,
    ensure_auth_secret,
    get_fastapi_main_path,
    get_server_binary_path,
    resolve_ports,
    start_ngrok_tunnel,
    stop_ngrok,
    wait_for_server,
)
from nao_core.config.base import NaoConfig, NaoConfigError
from nao_core.config.llm import LLMConfig, LLMProvider, ProviderConfig

SERVER_PORT = 8080
TIMEOUT = 1

INVALID_YAML = "project_name: [invalid yaml"
MISSING_PROJECT_NAME = "databases: []"
NGROK_URL = "https://abc123.ngrok-free.app"


@pytest.fixture
def chat_mocks(mock_chat_dependencies):
    """Patch everything `chat()` spawns or prints, with servers that start and exit immediately."""
    _, bin_dir = mock_chat_dependencies
    process = MagicMock()
    process.stdout = iter([])
    process.wait.return_value = 0
    with (
        patch("nao_core.commands.chat.console") as console,
        patch("nao_core.commands.chat.get_server_binary_path", return_value=bin_dir / "nao-chat-server"),
        patch("nao_core.commands.chat.get_fastapi_main_path", return_value=bin_dir / "fastapi" / "main.py"),
        patch("nao_core.commands.chat.subprocess.Popen", return_value=process) as popen,
        patch("nao_core.commands.chat.wait_for_server", return_value=True) as wait_for_server,
        patch("nao_core.commands.chat.webbrowser.open") as open_browser,
    ):
        yield SimpleNamespace(
            console=console,
            popen=popen,
            process=process,
            wait_for_server=wait_for_server,
            open_browser=open_browser,
        )


@pytest.fixture
def ngrok_mocks():
    with (
        patch("nao_core.commands.chat.start_ngrok_tunnel", return_value=NGROK_URL) as start_ngrok,
        patch("nao_core.commands.chat.stop_ngrok") as stop_ngrok,
    ):
        yield SimpleNamespace(start=start_ngrok, stop=stop_ngrok)


# Tests for try_load with exit_on_error=False (default, silent mode)


@pytest.mark.parametrize(
    "config_content",
    [None, INVALID_YAML, MISSING_PROJECT_NAME],
    ids=["file_not_found", "invalid_yaml", "validation_error"],
)
def test_try_load_returns_none_on_error(tmp_path: Path, config_content: str | None):
    _write_config(tmp_path, config_content)

    cfg = NaoConfig.try_load(tmp_path)
    assert cfg is None


def test_try_load_returns_config_when_valid(tmp_path: Path):
    _write_config(tmp_path, "project_name: test-project")

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


@pytest.mark.parametrize(
    ("config_content", "expected_fragments"),
    [
        (INVALID_YAML, ["Failed to load nao_config.yaml", "Invalid YAML syntax"]),
        (MISSING_PROJECT_NAME, ["Failed to load nao_config.yaml"]),
    ],
    ids=["invalid_yaml", "validation_error"],
)
def test_try_load_exits_on_invalid_config(tmp_path: Path, config_content: str, expected_fragments: list[str]):
    _write_config(tmp_path, config_content)

    with patch("nao_core.config.base.Console") as mock_console_cls:
        mock_console = mock_console_cls.return_value
        with pytest.raises(SystemExit) as exc_info:
            NaoConfig.try_load(tmp_path, exit_on_error=True)

        assert exc_info.value.code == 1
        assert mock_console.print.call_count == 1
        call_args = str(mock_console.print.call_args)
        for fragment in expected_fragments:
            assert fragment in call_args


# Tests for try_load with raise_on_error=True


@pytest.mark.parametrize(
    ("config_content", "expected_message"),
    [
        (None, "No nao_config.yaml found"),
        (INVALID_YAML, "Invalid YAML syntax"),
        (MISSING_PROJECT_NAME, "Failed to load nao_config.yaml"),
    ],
    ids=["file_not_found", "invalid_yaml", "validation_error"],
)
def test_try_load_raises_on_error(tmp_path: Path, config_content: str | None, expected_message: str):
    _write_config(tmp_path, config_content)

    with pytest.raises(NaoConfigError) as exc_info:
        NaoConfig.try_load(tmp_path, raise_on_error=True)

    assert expected_message in str(exc_info.value)


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
class TestResolvePorts:
    def test_uses_defaults_when_nothing_is_set(self):
        assert resolve_ports(None, None) == (5005, 8005)

    def test_falls_back_to_env_vars(self, monkeypatch):
        monkeypatch.setenv("SERVER_PORT", "6000")
        monkeypatch.setenv("FASTAPI_PORT", "9000")
        assert resolve_ports(None, None) == (6000, 9000)

    def test_explicit_ports_take_precedence_over_env_vars(self, monkeypatch):
        monkeypatch.setenv("FASTAPI_PORT", "9000")
        assert resolve_ports(6000, 9500) == (6000, 9500)

    def test_rejects_conflicting_ports(self):
        with pytest.raises(ValueError, match="different from FASTAPI_PORT"):
            resolve_ports(9000, 9000)

    def test_rejects_invalid_env_var(self, monkeypatch):
        monkeypatch.setenv("FASTAPI_PORT", "not-a-port")
        with pytest.raises(ValueError, match="FASTAPI_PORT must be a valid integer"):
            resolve_ports(None, None)

    def test_rejects_out_of_range_port(self):
        with pytest.raises(ValueError, match="between 1024 and 65535"):
            resolve_ports(None, 80)


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

    def test_chat_starts_both_servers(self, chat_mocks):
        """Verify that chat() starts both FastAPI and chat servers."""
        chat()

        # Popen called twice: once for FastAPI, once for chat server
        assert chat_mocks.popen.call_count == 2
        chat_mocks.open_browser.assert_called_once()
        assert "localhost" in str(chat_mocks.open_browser.call_args)

    def test_chat_sets_environment_variables(self, chat_mocks):
        """Verify that chat() sets required environment variables."""
        chat()

        env = _chat_server_env(chat_mocks)
        assert "NAO_DEFAULT_PROJECT_PATH" in env
        assert "BETTER_AUTH_SECRET" in env

    def test_chat_passes_fastapi_port_to_both_servers(self, chat_mocks):
        """Verify --fastapi-port binds FastAPI and points the chat server at it."""
        chat(fastapi_port=9005)

        fastapi_env = chat_mocks.popen.call_args_list[0].kwargs["env"]
        chat_server_env = chat_mocks.popen.call_args_list[1].kwargs["env"]
        assert fastapi_env["PORT"] == "9005"
        assert chat_server_env["FASTAPI_PORT"] == "9005"
        chat_mocks.wait_for_server.assert_any_call(9005)

    def test_chat_handles_keyboard_interrupt(self, chat_mocks):
        """Verify graceful shutdown on Ctrl+C."""
        _interrupt_server_output(chat_mocks.process)

        with pytest.raises(SystemExit) as exc_info:
            chat()

        assert exc_info.value.code == 0
        chat_mocks.process.terminate.assert_called()

    def test_chat_handles_server_crash(self, chat_mocks):
        """Verify error handling when server startup fails."""
        chat_mocks.popen.side_effect = OSError("Permission denied")

        with pytest.raises(SystemExit) as exc_info:
            chat()

        assert exc_info.value.code == 1

    def test_chat_waits_for_servers_before_opening_browser(self, chat_mocks):
        """Verify browser opens only after servers are ready."""
        chat()

        assert chat_mocks.wait_for_server.call_count == 2
        chat_mocks.open_browser.assert_called_once()

    def test_chat_continues_even_if_server_slow_to_start(self, chat_mocks):
        """Verify chat warns user when server is slow to start."""
        chat_mocks.wait_for_server.return_value = False

        chat()

        chat_mocks.open_browser.assert_not_called()
        calls = [str(c) for c in chat_mocks.console.print.call_args_list]
        assert any("taking longer than expected" in c for c in calls)

    def test_chat_sets_llm_api_key_from_config(self, chat_mocks, create_config):
        """Verify LLM API key from config is passed to server env."""
        create_config("""\
project_name: test-project
llm:
  provider: openai
  api_key: sk-test-key-12345
""")

        chat()

        assert _chat_server_env(chat_mocks).get("OPENAI_API_KEY") == "sk-test-key-12345"


class TestBuildLlmEnv:
    def test_exports_every_configured_provider(self):
        llm = LLMConfig(
            providers=[
                ProviderConfig(provider=LLMProvider.OPENAI, api_key="sk-openai", base_url="http://localhost:4000"),
                ProviderConfig(provider=LLMProvider.ANTHROPIC, api_key="sk-ant"),
            ]
        )

        assert build_llm_env(llm) == {
            "OPENAI_API_KEY": "sk-openai",
            "OPENAI_BASE_URL": "http://localhost:4000",
            "ANTHROPIC_API_KEY": "sk-ant",
        }

    def test_exports_bedrock_and_vertex_credentials(self):
        llm = LLMConfig(
            providers=[
                ProviderConfig(
                    provider=LLMProvider.BEDROCK,
                    access_key="AKIA_TEST",
                    secret_key="SECRET_TEST",
                    aws_region="eu-west-1",
                ),
                ProviderConfig(provider=LLMProvider.VERTEX, gcp_project="my-project", gcp_location="us-east5"),
            ]
        )

        assert build_llm_env(llm) == {
            "AWS_ACCESS_KEY_ID": "AKIA_TEST",
            "AWS_SECRET_ACCESS_KEY": "SECRET_TEST",
            "AWS_REGION": "eu-west-1",
            "GOOGLE_VERTEX_PROJECT": "my-project",
            "GOOGLE_VERTEX_LOCATION": "us-east5",
        }

    def test_leaves_the_annotation_model_to_the_config_file(self):
        llm = LLMConfig(
            providers=[ProviderConfig(provider=LLMProvider.OPENAI, api_key="sk-openai")],
            annotation_model="gpt-4.1-mini",
        )

        assert build_llm_env(llm) == {"OPENAI_API_KEY": "sk-openai"}


class TestStartNgrokTunnel:
    @patch("nao_core.commands.chat.console")
    def test_returns_https_url(self, mock_console):
        mock_tunnel = MagicMock()
        mock_tunnel.public_url = "https://abc123.ngrok-free.app"

        with patch("pyngrok.ngrok.connect", return_value=mock_tunnel):
            url = start_ngrok_tunnel(5005)

        assert url == "https://abc123.ngrok-free.app"

    @patch("nao_core.commands.chat.console")
    def test_converts_http_to_https(self, mock_console):
        mock_tunnel = MagicMock()
        mock_tunnel.public_url = "http://abc123.ngrok-free.app"

        with patch("pyngrok.ngrok.connect", return_value=mock_tunnel):
            url = start_ngrok_tunnel(5005)

        assert url == "https://abc123.ngrok-free.app"

    @patch("nao_core.commands.chat.console")
    def test_passes_port_to_ngrok(self, mock_console):
        mock_tunnel = MagicMock()
        mock_tunnel.public_url = "https://abc123.ngrok-free.app"

        with patch("pyngrok.ngrok.connect", return_value=mock_tunnel) as mock_connect:
            start_ngrok_tunnel(9999)

        mock_connect.assert_called_once_with("9999", "http")


class TestStopNgrok:
    def test_calls_ngrok_kill(self):
        with patch("pyngrok.ngrok.kill") as mock_kill:
            stop_ngrok()
        mock_kill.assert_called_once()

    def test_handles_exception_gracefully(self):
        with patch("pyngrok.ngrok.kill", side_effect=Exception("fail")):
            stop_ngrok()


class TestChatWithNgrok:
    def test_ngrok_sets_better_auth_url(self, chat_mocks, ngrok_mocks):
        """Verify --ngrok sets BETTER_AUTH_URL to the ngrok tunnel URL."""
        chat(ngrok=True)

        ngrok_mocks.start.assert_called_once_with(5005)
        assert _chat_server_env(chat_mocks).get("BETTER_AUTH_URL") == NGROK_URL

    def test_ngrok_opens_browser_with_ngrok_url(self, chat_mocks, ngrok_mocks):
        """Verify browser opens with the ngrok URL when --ngrok is used."""
        chat(ngrok=True)

        chat_mocks.open_browser.assert_called_once_with(NGROK_URL)

    def test_ngrok_shutdown_on_keyboard_interrupt(self, chat_mocks, ngrok_mocks):
        """Verify ngrok tunnel is closed on Ctrl+C."""
        _interrupt_server_output(chat_mocks.process)

        with pytest.raises(SystemExit) as exc_info:
            chat(ngrok=True)

        assert exc_info.value.code == 0
        ngrok_mocks.stop.assert_called_once()


def _write_config(project_path: Path, content: str | None) -> None:
    if content is not None:
        (project_path / "nao_config.yaml").write_text(content)


def _chat_server_env(chat_mocks) -> dict:
    return chat_mocks.popen.call_args_list[1].kwargs.get("env", {})


def _interrupt_server_output(process: MagicMock) -> None:
    process.stdout = MagicMock()
    process.stdout.__iter__ = MagicMock(side_effect=KeyboardInterrupt)
