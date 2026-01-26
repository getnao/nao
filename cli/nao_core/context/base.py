"""Base class for context providers."""

from abc import ABC, abstractmethod
from pathlib import Path


class ContextProvider(ABC):
    """Abstract base class for context providers.

    A context provider is responsible for loading the nao project context
    from a source (local filesystem, git repository, etc.) to the target path.
    """

    def __init__(self, target_path: Path):
        """Initialize the context provider.

        Args:
            target_path: The local filesystem path where context should be available.
        """
        self.target_path = target_path

    @abstractmethod
    def init(self) -> None:
        """Initialize the context.

        This is called on container startup to ensure context is available.
        For local provider, this validates the path exists.
        For git provider, this clones or pulls the repository.
        """
        pass

    @abstractmethod
    def refresh(self) -> bool:
        """Refresh the context from the source.

        Returns:
            True if context was updated, False if no changes.
        """
        pass

    @abstractmethod
    def is_initialized(self) -> bool:
        """Check if context has been initialized.

        Returns:
            True if context is available and ready.
        """
        pass

    def validate(self) -> bool:
        """Validate that the context contains required files.

        Returns:
            True if nao_config.yaml exists in target path.
        """
        config_file = self.target_path / "nao_config.yaml"
        return config_file.exists()
