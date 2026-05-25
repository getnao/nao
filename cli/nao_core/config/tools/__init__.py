"""Custom tools configuration module."""

import json
from pathlib import Path

from pydantic import BaseModel, Field

from nao_core.ui import UI, ask_confirm

from .template import generate_get_order_tool


class ToolsConfig(BaseModel):
    """Custom tools configuration."""

    folder_path: str = Field(description="Path to the tools folder")

    @classmethod
    def promptConfig(cls, project_name: str) -> None:
        """Prompt for custom tools configuration."""
        folder_path = "./agent/tools/"

        path = Path(folder_path).expanduser()
        if not path.is_absolute():
            base_path = Path(project_name) if project_name else Path.cwd()
            absolute_path = (base_path / path).resolve()
        else:
            absolute_path = path.resolve()

        if not absolute_path.exists():
            absolute_path.mkdir(parents=True, exist_ok=True)

            if ask_confirm(
                "Setup tools folder with get-order example tool?",
                default=True,
            ):
                tool_file = absolute_path / "get-order.json"
                tool_file.write_text(json.dumps(generate_get_order_tool(), indent=2) + "\n")
                UI.success(f"Created tools folder with get-order example: {absolute_path}")
            else:
                UI.success(f"Created empty tools folder: {absolute_path}")

        elif not absolute_path.is_dir():
            raise ValueError(f"Tools path exists but is not a directory: {absolute_path}")
