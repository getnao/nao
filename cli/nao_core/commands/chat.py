import os
import secrets
import subprocess
import sys
import webbrowser
from pathlib import Path
from time import sleep
from typing import Annotated, Optional

from cyclopts import Parameter
from rich.console import Console

from nao_core import __version__
from nao_core.config import NaoConfig
from nao_core.config.llm import PROVIDER_AUTH, LLMProvider
from nao_core.mode import MODE
from nao_core.tracking import track_command

console = Console()

DEFAULT_SERVER_PORT = 5005
FASTAPI_PORT = 8005
SECRET_FILE_NAME = ".nao-secret"


def validate_port(port: int | None) -> int:
    """Uses fallback values if port is not set and checks value for conflicts."""
    try:
        if port is None:
            fallback = os.getenv("SERVER_PORT", DEFAULT_SERVER_PORT)
            port = int(fallback)
    except (ValueError, TypeError) as e:
        raise ValueError(f"Port must be a valid integer. Got: {fallback}") from e

    if not (1024 <= port <= 65535):
        raise ValueError(f"Port must be between 1024 and 65535. Got: {port}")

    if port == FASTAPI_PORT:
        raise ValueError(f"Port must be different from FASTAPI_PORT ({FASTAPI_PORT})")

    return port


def get_server_binary_path() -> Path:
    """Get the path to the bundled nao-chat-server binary."""
    cli_dir = Path(__file__).parent.parent
    bin_dir = cli_dir / "bin"
    binary_name = "nao-chat-server.exe" if sys.platform == "win32" else "nao-chat-server"
    binary_path = bin_dir / binary_name

    if not binary_path.exists():
        console.print(f"[bold red]✗[/bold red] Server binary not found at {binary_path}")
        console.print("[dim]Make sure you've built the server by running python file build.py[/dim]")
        sys.exit(1)

    return binary_path


def get_fastapi_main_path() -> Path:
    """Get the path to the FastAPI main.py file."""
    cli_dir = Path(__file__).parent.parent
    bin_dir = cli_dir / "bin"
    fastapi_path = bin_dir / "fastapi" / "main.py"

    if not fastapi_path.exists():
        console.print(f"[bold red]✗[/bold red] FastAPI main.py not found at {fastapi_path}")
        sys.exit(1)

    return fastapi_path


def wait_for_server(port: int, timeout: int = 30) -> bool:
    """Wait for the server to be ready."""
    import socket

    for _ in range(timeout * 10):  # Check every 100ms
        try:
            with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
                sock.settimeout(0.1)
                result = sock.connect_ex(("localhost", port))
                if result == 0:
                    return True
        except OSError:
            pass
        sleep(0.1)
    return False


def ensure_auth_secret(bin_dir: Path) -> str | None:
    """Ensure auth secret exists, generating one if needed.

    Returns the secret value if one was loaded/generated, or None if
    BETTER_AUTH_SECRET is already set in the environment.
    """
    # If already set via environment, nothing to do
    if os.environ.get("BETTER_AUTH_SECRET"):
        return None

    secret_path = bin_dir / SECRET_FILE_NAME

    # Try to load existing secret from file
    if secret_path.exists():
        try:
            secret = secret_path.read_text().strip()
            if secret:
                console.print(f"[bold green]✓[/bold green] Loaded auth secret from {secret_path}")
                return secret
        except Exception:
            pass  # Fall through to generate new secret

    # Generate and save new secret
    new_secret = secrets.token_urlsafe(32)
    try:
        secret_path.write_text(new_secret)
        # Set restrictive permissions (owner read/write only)
        secret_path.chmod(0o600)
        console.print(f"[bold green]✓[/bold green] Generated new auth secret and saved to {secret_path}")
        return new_secret
    except Exception as e:
        console.print(f"[bold yellow]⚠[/bold yellow] Could not save auth secret to {secret_path}: {e}")
        console.print("[dim]Sessions will not persist across restarts[/dim]")
        return new_secret


def start_ngrok_tunnel(port: int) -> str:
    """Start an ngrok tunnel and return the public HTTPS URL."""
    try:
        from pyngrok import ngrok
    except ImportError:
        console.print("[bold red]✗[/bold red] pyngrok is required for --ngrok support")
        console.print("[dim]Install it with: pip install pyngrok[/dim]")
        sys.exit(1)

    tunnel = ngrok.connect(str(port), "http")
    public_url: str | None = tunnel.public_url

    if not public_url:
        console.print("[bold red]✗[/bold red] ngrok tunnel failed to return a public URL")
        sys.exit(1)

    assert public_url is not None
    if public_url.startswith("http://"):
        public_url = public_url.replace("http://", "https://", 1)

    console.print(f"[bold green]✓[/bold green] ngrok tunnel established: {public_url}")
    return public_url


def stop_ngrok():
    """Shut down all ngrok tunnels."""
    try:
        from pyngrok import ngrok

        ngrok.kill()
    except Exception:
        pass


@track_command("chat")
def chat(
    port: Annotated[Optional[int], Parameter(name=["-p", "--port"])] = None,
    *,
    ngrok: Annotated[bool, Parameter(name=["--ngrok"])] = False,
):
    """Start the nao chat UI.

    Launches the nao chat server and opens the web interface in your browser.

    Parameters
    ----------
    port : int
        Sets chat web app port. Defaults to `SERVER_PORT` env var and 5005 if not set.
        Must be different from FASTAPI_PORT (8005).
    ngrok : bool
        Start an ngrok tunnel to expose the chat server publicly. Useful for
        Slack integration workflows. Requires an ngrok account and authtoken.
    """
    console.print("\n[bold cyan]💬 Starting nao chat...[/bold cyan]\n")

    config = NaoConfig.try_load(exit_on_error=True)
    assert config is not None
    console.print(f"[bold green]✓[/bold green] Loaded config from {Path.cwd() / 'nao_config.yaml'}")

    binary_path = get_server_binary_path()
    bin_dir = binary_path.parent

    console.print(f"[dim]Server binary: {binary_path}[/dim]")
    console.print(f"[dim]Working directory: {bin_dir}[/dim]")

    chat_process = None
    fastapi_process = None
    ngrok_url = None

    def shutdown_servers():
        """Gracefully shut down server processes and ngrok tunnel."""
        if ngrok_url:
            stop_ngrok()
            console.print("[bold green]✓[/bold green] ngrok tunnel closed")
        for name, proc in (("Chat server", chat_process), ("FastAPI server", fastapi_process)):
            if proc:
                proc.terminate()
                try:
                    proc.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    proc.kill()
                    proc.wait()

    try:
        env = os.environ.copy()
        port = validate_port(port)

        auth_secret = ensure_auth_secret(bin_dir)
        if auth_secret:
            env["BETTER_AUTH_SECRET"] = auth_secret

        if config and config.llm:
            auth = PROVIDER_AUTH[config.llm.provider]
            if config.llm.api_key is not None and auth.api_key != "none":
                env[auth.env_var] = config.llm.api_key
                console.print(f"[bold green]✓[/bold green] Set {auth.env_var} from config")
            if config.llm.base_url and auth.base_url_env_var:
                env[auth.base_url_env_var] = config.llm.base_url
                console.print(f"[bold green]✓[/bold green] Set {auth.base_url_env_var} from config")

            if config.llm.provider == LLMProvider.BEDROCK:
                if config.llm.access_key:
                    env["AWS_ACCESS_KEY_ID"] = config.llm.access_key
                    console.print("[bold green]✓[/bold green] Set AWS_ACCESS_KEY_ID from config")
                if config.llm.secret_key:
                    env["AWS_SECRET_ACCESS_KEY"] = config.llm.secret_key
                    console.print("[bold green]✓[/bold green] Set AWS_SECRET_ACCESS_KEY from config")
                if config.llm.aws_region:
                    env["AWS_REGION"] = config.llm.aws_region
                    console.print("[bold green]✓[/bold green] Set AWS_REGION from config")

            if config.llm.provider == LLMProvider.VERTEX:
                if config.llm.gcp_project:
                    env["GOOGLE_VERTEX_PROJECT"] = config.llm.gcp_project
                    console.print("[bold green]✓[/bold green] Set GOOGLE_VERTEX_PROJECT from config")
                if config.llm.gcp_location:
                    env["GOOGLE_VERTEX_LOCATION"] = config.llm.gcp_location
                    console.print("[bold green]✓[/bold green] Set GOOGLE_VERTEX_LOCATION from config")
                if config.llm.service_account_json:
                    env["VERTEX_GOOGLE_SERVICE_ACCOUNT_JSON"] = config.llm.service_account_json
                    console.print("[bold green]✓[/bold green] Set VERTEX_GOOGLE_SERVICE_ACCOUNT_JSON from config")
                if config.llm.key_file:
                    env["VERTEX_GOOGLE_APPLICATION_CREDENTIALS"] = str(Path(config.llm.key_file).resolve())
                    console.print("[bold green]✓[/bold green] Set VERTEX_GOOGLE_APPLICATION_CREDENTIALS from config")

        env["NAO_DEFAULT_PROJECT_PATH"] = str(Path.cwd())

        if ngrok:
            ngrok_url = start_ngrok_tunnel(port)
            env["BETTER_AUTH_URL"] = ngrok_url
        elif "BETTER_AUTH_URL" not in os.environ:
            env["BETTER_AUTH_URL"] = f"http://localhost:{port}"

        env["MODE"] = MODE
        env["NAO_CORE_VERSION"] = __version__

        fastapi_path = get_fastapi_main_path()
        console.print(f"[dim]FastAPI server: {fastapi_path}[/dim]")

        fastapi_process = subprocess.Popen(
            [sys.executable, str(fastapi_path)],
            env=env,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )

        console.print("[bold green]✓[/bold green] FastAPI server starting...")

        if wait_for_server(FASTAPI_PORT):
            console.print(f"[bold green]✓[/bold green] FastAPI server ready at http://localhost:{FASTAPI_PORT}")
        else:
            console.print("[bold yellow]⚠[/bold yellow] FastAPI server is taking longer than expected to start...")

        chat_process = subprocess.Popen(
            [str(binary_path), "--port", str(port)],
            cwd=str(bin_dir),
            env=env,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            encoding="utf-8",
            errors="replace",
        )

        console.print("[bold green]✓[/bold green] Chat server starting...")

        if wait_for_server(port):
            url = ngrok_url or f"http://localhost:{port}"
            console.print(f"[bold green]✓[/bold green] Chat server ready at {url}")
            console.print("\n[bold]Opening browser...[/bold]")
            webbrowser.open(url)
            console.print("\n[dim]Press Ctrl+C to stop the servers[/dim]\n")
        else:
            console.print("[bold yellow]⚠[/bold yellow] Chat server is taking longer than expected to start...")
            console.print(f"[dim]Check http://localhost:{port} manually[/dim]")

        if chat_process.stdout:
            for line in chat_process.stdout:
                console.print(f"[dim]{line.rstrip()}[/dim]")

        chat_process.wait()

    except KeyboardInterrupt:
        console.print("\n[bold yellow]Shutting down...[/bold yellow]")
        shutdown_servers()
        console.print("[bold green]✓[/bold green] Servers stopped")
        sys.exit(0)

    except Exception as e:
        console.print(f"[bold red]✗[/bold red] Failed to start servers: {e}")
        shutdown_servers()
        sys.exit(1)
