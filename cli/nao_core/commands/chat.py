import os
import secrets
import subprocess
import sys
import webbrowser
from pathlib import Path
from time import sleep

from rich.console import Console

from nao_core.config import NaoConfig

console = Console()

# Default port for the nao chat server
SERVER_PORT = 5005
FASTAPI_PORT = 8005
SECRET_FILE_NAME = ".nao-secret"


def get_server_binary_path() -> Path:
    """Get the path to the bundled nao-chat-server binary."""
    # The binary is in the bin folder relative to this file
    cli_dir = Path(__file__).parent.parent
    bin_dir = cli_dir / "bin"
    binary_path = bin_dir / "nao-chat-server"

    if not binary_path.exists():
        console.print(f"[bold red]✗[/bold red] Server binary not found at {binary_path}")
        console.print("[dim]Make sure you've built the server with ./scripts/build-server.sh[/dim]")
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


def chat():
    """Start the nao chat UI.

    Launches the nao chat server and opens the web interface in your browser.
    """
    console.print("\n[bold cyan]💬 Starting nao chat...[/bold cyan]\n")

    # Try to load nao config from current directory
    config = NaoConfig.try_load()
    if config:
        console.print(f"[bold green]✓[/bold green] Loaded config from {Path.cwd() / 'nao_config.yaml'}")
    else:
        console.print(
            "[bold red]✗No nao_config.yaml found in current directory. Please move to a nao project directory.[/bold red]"
        )
        sys.exit(1)

    binary_path = get_server_binary_path()
    bin_dir = binary_path.parent

    console.print(f"[dim]Server binary: {binary_path}[/dim]")
    console.print(f"[dim]Working directory: {bin_dir}[/dim]")

    # Start the server processes
    chat_process = None
    fastapi_process = None

    def shutdown_servers():
        """Gracefully shut down both server processes."""
        for name, proc in [("Chat server", chat_process), ("FastAPI server", fastapi_process)]:
            if proc:
                proc.terminate()
                try:
                    proc.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    proc.kill()
                    proc.wait()

    try:
        # Set up environment - inherit from parent but ensure we're in the bin dir
        # so the server can find the public folder
        env = os.environ.copy()

        # Ensure auth secret is available
        auth_secret = ensure_auth_secret(bin_dir)
        if auth_secret:
            env["BETTER_AUTH_SECRET"] = auth_secret

        # Set LLM API key from config if available
        if config and config.llm:
            env_var_name = f"{config.llm.provider.upper()}_API_KEY"
            env[env_var_name] = config.llm.api_key
            console.print(f"[bold green]✓[/bold green] Set {env_var_name} from config")

        # Set Slack config if available
        if config and config.slack:
            env["SLACK_BOT_TOKEN"] = config.slack.bot_token
            env["SLACK_SIGNING_SECRET"] = config.slack.signing_secret
            console.print("[bold green]✓[/bold green] Set Slack environment variables from config")

        env["NAO_DEFAULT_PROJECT_PATH"] = str(Path.cwd())
        env["FASTAPI_URL"] = f"http://localhost:{FASTAPI_PORT}"

        # Start the FastAPI server first
        fastapi_path = get_fastapi_main_path()
        console.print(f"[dim]FastAPI server: {fastapi_path}[/dim]")

        fastapi_process = subprocess.Popen(
            [sys.executable, str(fastapi_path)],
            env=env,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )

        console.print("[bold green]✓[/bold green] FastAPI server starting...")

        # Wait for FastAPI server to be ready
        if wait_for_server(FASTAPI_PORT):
            console.print(f"[bold green]✓[/bold green] FastAPI server ready at http://localhost:{FASTAPI_PORT}")
        else:
            console.print("[bold yellow]⚠[/bold yellow] FastAPI server is taking longer than expected to start...")

        # Start the chat server
        chat_process = subprocess.Popen(
            [str(binary_path)],
            cwd=str(bin_dir),
            env=env,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
        )

        console.print("[bold green]✓[/bold green] Chat server starting...")

        # Wait for the chat server to be ready
        if wait_for_server(SERVER_PORT):
            url = f"http://localhost:{SERVER_PORT}"
            console.print(f"[bold green]✓[/bold green] Chat server ready at {url}")
            console.print("\n[bold]Opening browser...[/bold]")
            webbrowser.open(url)
            console.print("\n[dim]Press Ctrl+C to stop the servers[/dim]\n")
        else:
            console.print("[bold yellow]⚠[/bold yellow] Chat server is taking longer than expected to start...")
            console.print(f"[dim]Check http://localhost:{SERVER_PORT} manually[/dim]")

        # Stream chat server output to console
        if chat_process.stdout:
            for line in chat_process.stdout:
                # Filter out some of the verbose logging if needed
                console.print(f"[dim]{line.rstrip()}[/dim]")

        # Wait for process to complete
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
