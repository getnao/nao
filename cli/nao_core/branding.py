"""Terminal branding for nao."""

from __future__ import annotations

import os
import sys

from rich.console import Console
from rich.panel import Panel
from rich.style import Style
from rich.table import Table
from rich.text import Text

PANEL_BLUE = "#4f7cff"
UPPER_HALF = "▀"
LOWER_HALF = "▄"

LOGO_PIXELS: list[list[str | None]] = [
    [
        "#5344f1",
        "#5037fc",
        "#4d2ef7",
        "#4d2bf7",
        "#7161f7",
        "#8581f9",
        "#7f77f9",
        "#786ef8",
        "#7062f8",
        "#6755f7",
        "#6148fc",
        "#5c41ed",
    ],
    [
        "#5040f5",
        "#4e36fa",
        "#5032f7",
        "#4e2cf8",
        "#5b40f7",
        "#8480f7",
        "#8380f7",
        "#8078f8",
        "#786df8",
        "#6d5cf7",
        "#6049fb",
        "#573df4",
    ],
    [
        "#503ff9",
        "#4e37f7",
        "#4426f7",
        "#4525f7",
        "#4f32f7",
        "#c6bff9",
        "#d1d1fa",
        "#7f7af8",
        "#7165f8",
        "#6251f7",
        "#5f4bf7",
        "#5942f9",
    ],
    [
        "#5141f7",
        "#4c36f6",
        "#a99df7",
        "#ad9ff7",
        "#4e35f4",
        "#ffffff",
        "#ffffff",
        "#766ff6",
        "#bfb9f9",
        "#b5acf8",
        "#5c4bf6",
        "#5d4df7",
    ],
    [
        "#5647f8",
        "#4c38f6",
        "#cec9f9",
        "#ffffff",
        "#8e82f6",
        "#b9b5f8",
        "#bfbdf9",
        "#9d97f7",
        "#ffffff",
        "#d2cef9",
        "#5b50f6",
        "#645bf8",
    ],
    [
        "#574af7",
        "#594af7",
        "#5d4bf5",
        "#978bf6",
        "#cac7f8",
        "#9b97f6",
        "#9994f6",
        "#cac6f8",
        "#9d96f7",
        "#6a62f5",
        "#6a67f7",
        "#6b69f8",
    ],
    [
        "#4e41f6",
        "#c3bff8",
        "#ffffff",
        "#beb8f8",
        "#958cf4",
        "#7d73f6",
        "#786cf7",
        "#9289f4",
        "#c0bcf8",
        "#ffffff",
        "#cbcdfa",
        "#6a71f6",
    ],
    [
        "#5243f6",
        "#8c80f7",
        "#a89ef9",
        "#9c91f7",
        "#7e6ff6",
        "#6b5bf7",
        "#695bf7",
        "#7f77f6",
        "#a5a6f8",
        "#b5bbfa",
        "#a3adf8",
        "#7785f7",
    ],
    [
        "#5645fb",
        "#4b37f6",
        "#4d36f7",
        "#533cf7",
        "#5e47f8",
        "#6451f8",
        "#685cf7",
        "#6966f8",
        "#6b73f8",
        "#7283f7",
        "#798ff9",
        "#869cfc",
    ],
    [
        "#5441f2",
        "#573eff",
        "#543bf6",
        "#583df7",
        "#5b3ff8",
        "#604cf8",
        "#6860f8",
        "#7377f8",
        "#7e8ff9",
        "#89a1fb",
        "#96b2ff",
        "#8aa5f9",
    ],
    [
        None,
        "#543cf6",
        "#5234fa",
        "#5031f7",
        "#5639f7",
        "#5f4df7",
        "#6a65f8",
        "#767ff8",
        "#849bfa",
        "#90aefc",
        "#8faffb",
        None,
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
    body.add_row(render_logo(), content)

    panel = Panel(
        body,
        border_style=PANEL_BLUE,
        title=f"[b {PANEL_BLUE}]nao[/] [dim]v{version}[/]",
        title_align="left",
        padding=(0, 1),
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
