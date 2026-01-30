"""CLI UI utilities using questionary and Rich."""

import questionary
from rich.console import Console
from rich.panel import Panel

console = Console()


class UI:
    """Clean helpers for terminal output using Rich."""

    _console = console

    @classmethod
    def success(cls, msg: str) -> None:
        cls._console.print(f"[bold green]✓[/bold green] {msg}")

    @classmethod
    def warn(cls, msg: str) -> None:
        cls._console.print(f"[yellow]{msg}[/yellow]")

    @classmethod
    def error(cls, msg: str) -> None:
        cls._console.print(f"[bold red]✗[/bold red] {msg}")

    @classmethod
    def title(cls, msg: str) -> None:
        cls._console.print(f"\n[bold yellow]{msg}[/bold yellow]")

    @classmethod
    def info(cls, msg: str) -> None:
        cls._console.print(f"[bold cyan]{msg}[/bold cyan]")

    @classmethod
    def bullet(cls, item: str) -> None:
        cls._console.print(f"  [cyan]•[/cyan] {item}")

    @classmethod
    def bullets(cls, items: list[str]) -> None:
        for item in items:
            cls.bullet(item)

    @classmethod
    def panel(cls, content: str, title: str | None = None, style: str = "cyan") -> None:
        cls._console.print(Panel(content, title=title, border_style=style))

    @classmethod
    def print(cls, msg: str = "") -> None:
        cls._console.print(msg)


# =============================================================================
# Questionary prompt helpers
# =============================================================================


def ask_text(
    message: str,
    default: str = "",
    password: bool = False,
    required_field: bool = False,
) -> str | None:
    """Ask for text input. Loops until filled if required_field=True."""
    prompt_fn = questionary.password if password else questionary.text

    while True:
        result = prompt_fn(message, default=default).ask()
        if result is None:  # User cancelled (Ctrl+C)
            raise KeyboardInterrupt

        value = result.strip() if result else None

        if required_field and not value:
            UI.warn("This field is required.")
            continue

        return value


def ask_confirm(message: str, default: bool = True) -> bool:
    """Ask for confirmation."""
    result = questionary.confirm(message, default=default).ask()
    if result is None:
        raise KeyboardInterrupt
    return result


def ask_select(
    message: str,
    choices: list[questionary.Choice] | list[str],
    default: str | None = None,
) -> str:
    """Ask user to select from choices."""
    result = questionary.select(message, choices=choices, default=default).ask()
    if result is None:
        raise KeyboardInterrupt
    return result
