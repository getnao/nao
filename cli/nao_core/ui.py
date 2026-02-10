"""CLI UI utilities using questionary and Rich."""

import pandas as pd
import questionary
from rich.console import Console
from rich.panel import Panel
from rich.table import Table

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

    @classmethod
    def table(
        cls,
        df: pd.DataFrame,
        title: str | None = None,
        sum_columns: dict[str, str] | None = None,
    ) -> None:
        """Print a DataFrame as a table.

        Args:
            df: DataFrame to display.
            title: Optional table title.
            sum_columns: Dict of column names to sum with their unit (e.g. {"Cost": "$", "Tokens": ""}).
        """
        table = Table(title=title)

        for col in df.columns:
            table.add_column(str(col))

        for _, row in df.iterrows():
            table.add_row(*[str(v) for v in row])

        # Add totals row if sum_columns specified
        if sum_columns:
            totals = []
            for col in df.columns:
                if col in sum_columns:
                    unit = sum_columns[col]
                    total = df[col].sum()
                    if unit == "$":
                        totals.append(f"${total:.4f}")
                    else:
                        totals.append(f"{int(total)}{unit}")
                else:
                    totals.append("")
            table.add_row(*totals, style="bold")

        cls._console.print(table)


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
