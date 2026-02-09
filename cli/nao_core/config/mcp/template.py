"""MCP configuration template generator."""


def generate_metabase_template() -> dict:
    """Generate default MCP configuration with Metabase server example.

    Returns:
        dict: MCP configuration with a Metabase server example that uses
              environment variables for credentials.
    """
    return {
        "mcpServers": {
            "metabase": {
                "command": "npx",
                "args": ["-y", "@getnao/metabase-mcp-server@latest"],
                "env": {
                    "METABASE_URL": "${METABASE_URL}",
                    "METABASE_API_KEY": "${METABASE_API_KEY}",
                },
            }
        }
    }


def generate_default_template() -> dict:
    """Generate default empty MCP configuration.

    Returns:
        dict: Empty MCP configuration with no servers defined.
    """
    return {"mcpServers": {}}
