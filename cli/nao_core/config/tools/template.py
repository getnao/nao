"""Custom tools configuration template generator."""


def generate_get_order_tool() -> dict:
    """Generate example get-order tool spec."""
    return {
        "name": "get_order",
        "description": "Get order details by order ID",
        "inputSchema": {
            "type": "object",
            "properties": {"order_id": {"type": "string", "description": "The order ID to look up"}},
            "required": ["order_id"],
        },
        "command": "python",
        "args": ["scripts/get_order.py"],
        "input": "stdin",
        "env": {},
    }
