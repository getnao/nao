from pydantic import BaseModel, Field


class McpConfig(BaseModel):
    """MCP (Model Context Protocol) configuration."""

    json_file_path: str = Field(description="Path to the MCP JSON configuration file")
