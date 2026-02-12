import json
from pathlib import Path

from pydantic import BaseModel, Field

from nao_core.ui import UI, ask_confirm, ask_text

from .template import generate_default_template, generate_metabase_template


class McpConfig(BaseModel):
    """MCP (Model Context Protocol) configuration."""

    json_file_path: str = Field(description="Path to the MCP JSON configuration file")

    @classmethod
    def promptConfig(cls, project_name: str) -> "McpConfig":
        """Interactively prompt the user for MCP configuration."""
        UI.info("Enter the path to your MCP JSON configuration file:")

        json_file_path = ask_text(
            "MCP JSON file path:",
            required_field=True,
            default="./agent/mcps/mcp.json",
        )
        if not json_file_path:
            raise ValueError("MCP JSON file path is required")

        # Expand user home directory if present
        file_path = Path(json_file_path).expanduser()

        # Resolve to absolute path for validation and file operations
        if not file_path.is_absolute():
            # Use project_name as base path if provided
            base_path = Path(project_name) if project_name else Path.cwd()
            absolute_path = (base_path / file_path).resolve()
        else:
            absolute_path = file_path.resolve()

        # Validate that path has .json extension
        if absolute_path.suffix.lower() != ".json":
            raise ValueError(f"MCP file must be a JSON file (got {absolute_path.suffix}): {absolute_path}")

        if not absolute_path.exists():
            # Create parent directory if needed
            absolute_path.parent.mkdir(parents=True, exist_ok=True)

            if ask_confirm(
                "Create file with Metabase MCP config example?",
                default=True,
            ):
                # Generate and write template with Metabase example
                template = generate_metabase_template()
                absolute_path.write_text(json.dumps(template, indent=2) + "\n")

                UI.success(f"Created MCP config file: {absolute_path}")
                UI.info("Remember to set these environment variables:")
                UI.info("  - METABASE_URL")
                UI.info("  - METABASE_API_KEY")
            else:
                # Create default MCP configuration
                template = generate_default_template()
                absolute_path.write_text(json.dumps(template, indent=2) + "\n")

                UI.success(f"Created empty MCP config file: {absolute_path}")
                UI.info("You can add MCP servers to this file later.")

        elif not absolute_path.is_file():
            raise ValueError(f"MCP JSON path exists but is not a file: {absolute_path}")

        return McpConfig(
            json_file_path=json_file_path,
        )
