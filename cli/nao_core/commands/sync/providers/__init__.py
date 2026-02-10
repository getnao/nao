"""Sync providers for different resource types."""

from dataclasses import dataclass

from .base import SyncProvider, SyncResult
from .databases.provider import DatabaseSyncProvider
from .notion.provider import NotionSyncProvider
from .repositories.provider import RepositorySyncProvider

# Provider registry mapping CLI-friendly names to provider instances
PROVIDER_REGISTRY: dict[str, SyncProvider] = {
    "notion": NotionSyncProvider(),
    "repositories": RepositorySyncProvider(),
    "databases": DatabaseSyncProvider(),
}

# Default providers in order of execution
DEFAULT_PROVIDERS: list[SyncProvider] = list(PROVIDER_REGISTRY.values())

# Valid provider names for CLI help text
PROVIDER_CHOICES: list[str] = list(PROVIDER_REGISTRY.keys())


@dataclass
class ProviderSelection:
    """A provider with an optional connection name filter."""

    provider: SyncProvider
    connection_name: str | None = None


def get_all_providers() -> list[ProviderSelection]:
    """Get all registered sync providers."""
    return [ProviderSelection(p) for p in DEFAULT_PROVIDERS]


def parse_provider_arg(arg: str) -> ProviderSelection:
    """Parse a provider argument like 'databases' or 'databases:my-connection'.

    Raises:
        ValueError: If the provider name is not valid.
    """
    if ":" in arg:
        provider_name, connection_name = arg.split(":", 1)
    else:
        provider_name = arg
        connection_name = None

    provider_name_lower = provider_name.lower()
    if provider_name_lower not in PROVIDER_REGISTRY:
        valid = ", ".join(PROVIDER_CHOICES)
        raise ValueError(f"Unknown provider '{provider_name}'. Valid options: {valid}")

    return ProviderSelection(
        provider=PROVIDER_REGISTRY[provider_name_lower],
        connection_name=connection_name,
    )


def get_providers_by_names(names: list[str]) -> list[ProviderSelection]:
    """Get provider selections by their CLI-friendly names.

    Supports 'provider' or 'provider:connection_name' syntax.

    Raises:
        ValueError: If any provider name is not valid.
    """
    return [parse_provider_arg(name) for name in names]


__all__ = [
    "SyncProvider",
    "SyncResult",
    "ProviderSelection",
    "DatabaseSyncProvider",
    "RepositorySyncProvider",
    "PROVIDER_REGISTRY",
    "PROVIDER_CHOICES",
    "DEFAULT_PROVIDERS",
    "get_all_providers",
    "get_providers_by_names",
]
