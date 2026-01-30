"""Sync providers for different resource types."""

from .base import SyncProvider, SyncResult
from .databases.provider import DatabaseSyncProvider
from .notion.provider import NotionSyncProvider
from .repositories.provider import RepositorySyncProvider

# Default providers in order of execution
DEFAULT_PROVIDERS: list[SyncProvider] = [
    NotionSyncProvider(),
    RepositorySyncProvider(),
    DatabaseSyncProvider(),
]


def get_all_providers() -> list[SyncProvider]:
    """Get all registered sync providers.

    Returns:
            List of sync provider instances
    """
    return DEFAULT_PROVIDERS.copy()


__all__ = [
    "SyncProvider",
    "SyncResult",
    "DatabaseSyncProvider",
    "RepositorySyncProvider",
    "DEFAULT_PROVIDERS",
    "get_all_providers",
]
