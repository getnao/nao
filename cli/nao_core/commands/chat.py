import os
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


def chat():
    """Start the nao chat UI.

    Launches the nao chat server and opens the web interface in your browser.
    """
    console.print("\n[bold cyan]💬 Starting nao chat...[/bold cyan]\n")

    binary_path = get_server_binary_path()
    bin_dir = binary_path.parent

    console.print(f"[dim]Server binary: {binary_path}[/dim]")
    console.print(f"[dim]Working directory: {bin_dir}[/dim]")

    # Try to load nao config from current directory
    config = NaoConfig.try_load()
    if config:
        console.print(f"[bold green]✓[/bold green] Loaded config from {Path.cwd() / 'nao_config.yaml'}")
    else:
        console.print("[dim]No nao_config.yaml found in current directory[/dim]")

    # Start the server process
    process = None
    try:
        # Set up environment - inherit from parent but ensure we're in the bin dir
        # so the server can find the public folder
        env = os.environ.copy()

        # Set LLM API key from config if available
        if config and config.llm:
            env_var_name = f"{config.llm.provider.upper()}_API_KEY"
            env[env_var_name] = config.llm.api_key
            console.print(f"[bold green]✓[/bold green] Set {env_var_name} from config")

        process = subprocess.Popen(
            [str(binary_path)],
            cwd=str(bin_dir),
            env=env,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
        )

        console.print("[bold green]✓[/bold green] Server starting...")

        # Wait for the server to be ready
        if wait_for_server(SERVER_PORT):
            url = f"http://localhost:{SERVER_PORT}"
            console.print(f"[bold green]✓[/bold green] Server ready at {url}")
            console.print("\n[bold]Opening browser...[/bold]")
            webbrowser.open(url)
            console.print("\n[dim]Press Ctrl+C to stop the server[/dim]\n")
        else:
            console.print("[bold yellow]⚠[/bold yellow] Server is taking longer than expected to start...")
            console.print(f"[dim]Check http://localhost:{SERVER_PORT} manually[/dim]")

        # Stream server output to console
        if process.stdout:
            for line in process.stdout:
                # Filter out some of the verbose logging if needed
                console.print(f"[dim]{line.rstrip()}[/dim]")

        # Wait for process to complete
        process.wait()

    except KeyboardInterrupt:
        console.print("\n[bold yellow]Shutting down...[/bold yellow]")
        if process:
            # Send SIGTERM for graceful shutdown
            process.terminate()
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                # Force kill if it doesn't respond
                process.kill()
                process.wait()
        console.print("[bold green]✓[/bold green] Server stopped")
        sys.exit(0)

    except Exception as e:
        console.print(f"[bold red]✗[/bold red] Failed to start server: {e}")
        if process:
            process.kill()
        sys.exit(1)
