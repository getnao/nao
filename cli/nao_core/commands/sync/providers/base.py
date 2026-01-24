"""Base class for sync providers."""

from abc import ABC, abstractmethod
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from nao_core.config import NaoConfig


@dataclass
class SyncResult:
    """Result of a sync operation."""

    provider_name: str
    items_synced: int
    details: dict[str, Any] | None = None
    summary: str | None = None

    def get_summary(self) -> str:
        """Get a human-readable summary of the sync result."""
        if self.summary:
            return self.summary
        return f"{self.items_synced} synced"


class SyncProvider(ABC):
    """Abstract base class for sync providers.

    A sync provider is responsible for synchronizing a specific type of resource
    (e.g., repositories, databases) from the nao configuration to local files.
    """

    @property
    @abstractmethod
    def name(self) -> str:
        """Human-readable name for this provider (e.g., 'Repositories', 'Databases')."""
        ...

    @property
    @abstractmethod
    def emoji(self) -> str:
        """Emoji icon for this provider."""
        ...

    @property
    @abstractmethod
    def default_output_dir(self) -> str:
        """Default output directory for this provider."""
        ...

    @abstractmethod
    def get_items(self, config: NaoConfig) -> list[Any]:
        """Extract items to sync from the configuration.

        Args:
                config: The nao configuration

        Returns:
                List of items to sync (e.g., repo configs, database configs)
        """
        ...

    @abstractmethod
    def sync(self, items: list[Any], output_path: Path) -> SyncResult:
        """Sync the items to the output path.

        Args:
                items: List of items to sync
                output_path: Path where synced data should be written

        Returns:
                SyncResult with statistics about what was synced
        """
        ...

    def should_sync(self, config: NaoConfig) -> bool:
        """Check if this provider has items to sync.

        Args:
                config: The nao configuration

        Returns:
                True if there are items to sync
        """
        return len(self.get_items(config)) > 0
