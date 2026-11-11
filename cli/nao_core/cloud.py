"""Detection of the hosted nao Cloud runtime."""

import os


def is_nao_cloud() -> bool:
    """On nao Cloud, the server's own ambient credentials must never authenticate a customer connection."""
    return os.environ.get("NAO_MODE") == "cloud"
