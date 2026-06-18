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


def generate_mixpanel_template() -> dict:
    """Generate MCP configuration with a Mixpanel OAuth server example.

    Mixpanel's hosted MCP requires per-user OAuth, so the server opts into nao's
    OAuth connection flow via the ``oauth`` block instead of static headers. When
    the server supports dynamic client registration no ``clientId`` is needed;
    otherwise set ``clientId`` (and ``clientSecretEnv`` for a confidential client).

    Returns:
        dict: MCP configuration with a Mixpanel server that authenticates via OAuth.
    """
    return {
        "mcpServers": {
            "mixpanel": {
                "transport": "streamable-http",
                "url": "https://mcp-eu.mixpanel.com/mcp",
                "oauth": {
                    "dynamicRegistration": True,
                    "scopes": [],
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
