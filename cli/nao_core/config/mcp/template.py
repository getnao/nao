"""MCP configuration template generator."""


def generate_metabase_template() -> dict:
    """Generate an MCP configuration for Metabase's official server."""
    return {
        "mcpServers": {
            "metabase": {
                "transport": "streamable-http",
                "url": "${METABASE_URL}/api/metabase-mcp",
            }
        }
    }


def generate_default_template() -> dict:
    """Generate default empty MCP configuration.

    Returns:
        dict: Empty MCP configuration with no servers defined.
    """
    return {"mcpServers": {}}
