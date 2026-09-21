"""Terminal branding for nao."""

from __future__ import annotations

import os
import sys

from rich import box
from rich.console import Console
from rich.padding import Padding
from rich.panel import Panel
from rich.style import Style
from rich.table import Table
from rich.text import Text

PANEL_BLUE = "#4f7cff"
UPPER_HALF = "▀"
LOWER_HALF = "▄"

LOGO_PIXELS: list[list[str | None]] = [
    [
        None,
        None,
        None,
        None,
        None,
        None,
        None,
        "#6038f8",
        "#6038f8",
        "#6038f8",
        "#6038f8",
        None,
        None,
        None,
        None,
        None,
        None,
        None,
    ],
    [
        None,
        None,
        None,
        None,
        None,
        None,
        None,
        "#6038f8",
        "#6038f8",
        "#6038f8",
        "#6038f8",
        None,
        None,
        None,
        None,
        None,
        None,
        None,
    ],
    [
        None,
        None,
        "#6038f8",
        "#6038f8",
        "#6038f8",
        None,
        None,
        "#6038f8",
        "#6038f8",
        "#6038f8",
        "#6038f8",
        None,
        None,
        "#6038f8",
        "#6038f8",
        "#6038f8",
        None,
        None,
    ],
    [
        None,
        None,
        "#6038f8",
        "#6038f8",
        "#6038f8",
        None,
        None,
        None,
        "#6038f8",
        "#6038f8",
        None,
        None,
        None,
        "#6038f8",
        "#6038f8",
        "#6038f8",
        None,
        None,
    ],
    [
        None,
        None,
        "#6038f8",
        "#6038f8",
        "#6038f8",
        "#6038f8",
        None,
        None,
        "#6038f8",
        "#6038f8",
        None,
        None,
        "#6038f8",
        "#6038f8",
        "#6038f8",
        "#6038f8",
        None,
        None,
    ],
    [
        None,
        None,
        None,
        "#6038f8",
        "#6038f8",
        "#6038f8",
        "#6038f8",
        None,
        "#6038f8",
        "#6038f8",
        None,
        "#6038f8",
        "#6038f8",
        "#6038f8",
        "#6038f8",
        "#6038f8",
        None,
        None,
    ],
    [
        None,
        None,
        None,
        None,
        None,
        "#6038f8",
        "#6038f8",
        None,
        "#6038f8",
        "#6038f8",
        None,
        "#6038f8",
        "#6038f8",
        "#6038f8",
        None,
        None,
        None,
        None,
    ],
    [
        "#6038f8",
        "#6038f8",
        "#6038f8",
        "#6038f8",
        None,
        None,
        "#6038f8",
        None,
        None,
        None,
        None,
        "#6038f8",
        None,
        None,
        "#6038f8",
        "#6038f8",
        "#6038f8",
        "#6038f8",
    ],
    [
        "#6038f8",
        "#6038f8",
        "#6038f8",
        "#6038f8",
        "#6038f8",
        "#6038f8",
        None,
        None,
        None,
        None,
        None,
        None,
        "#6038f8",
        "#6038f8",
        "#6038f8",
        "#6038f8",
        "#6038f8",
        "#6038f8",
    ],
    [
        "#6038f8",
        "#6038f8",
        "#6038f8",
        "#6038f8",
        "#6038f8",
        "#6038f8",
        None,
        None,
        None,
        None,
        None,
        None,
        "#6038f8",
        "#6038f8",
        "#6038f8",
        "#6038f8",
        "#6038f8",
        "#6038f8",
    ],
]


def render_logo() -> Text:
    """Render the pixel matrix with half-block characters, leaving None pixels transparent."""
    logo = Text()
    for row_index in range(0, len(LOGO_PIXELS), 2):
        top_row = LOGO_PIXELS[row_index]
        bottom_row = LOGO_PIXELS[row_index + 1] if row_index + 1 < len(LOGO_PIXELS) else [None] * len(top_row)
        for top_pixel, bottom_pixel in zip(top_row, bottom_row, strict=True):
            if top_pixel is None and bottom_pixel is None:
                logo.append(" ")
            elif bottom_pixel is None:
                logo.append(UPPER_HALF, Style(color=top_pixel))
            elif top_pixel is None:
                logo.append(LOWER_HALF, Style(color=bottom_pixel))
            else:
                logo.append(UPPER_HALF, Style(color=top_pixel, bgcolor=bottom_pixel))
        if row_index + 2 < len(LOGO_PIXELS):
            logo.append("\n")
    return logo


def banner(console: Console, version: str) -> None:
    """Print the nao terminal banner."""
    content = Text("\n")
    content.append("Welcome to nao", style="bold")
    content.append("\nanalytics agents", style="dim")
    content.append("\n\nTry: ", style="dim")
    content.append("nao init · nao chat · nao sync", style=PANEL_BLUE)

    body = Table.grid(padding=(0, 2))
    body.add_column()
    body.add_column()
    body.add_row(Padding(render_logo(), (0, 2, 0, 1)), content)

    panel = Panel(
        body,
        box=box.ROUNDED,
        border_style=PANEL_BLUE,
        title=f"[b {PANEL_BLUE}]nao[/] [dim]v{version}[/]",
        title_align="left",
        padding=(1, 2),
        expand=False,
    )
    console.print()
    console.print(panel)
    console.print()


def should_show_banner() -> bool:
    """Return whether the terminal supports showing the banner."""
    return (
        sys.stdout.isatty()
        and os.environ.get("NO_COLOR") is None
        and os.environ.get("NAO_NO_BANNER") is None
        and os.environ.get("TERM") != "dumb"
    )
