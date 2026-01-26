"""Local filesystem context provider."""

from pathlib import Path

from .base import ContextProvider


class LocalContextProvider(ContextProvider):
    """Context provider for local filesystem.

    This is the default provider that expects context to already exist
    at the target path (e.g., via Docker volume mount).
    """

    def __init__(self, target_path: Path):
        """Initialize the local context provider.

        Args:
            target_path: Path where context should exist.
        """
        super().__init__(target_path)

    def init(self) -> None:
        """Validate that the local context path exists.

        Raises:
            FileNotFoundError: If target path does not exist.
            ValueError: If nao_config.yaml is not found.
        """
        if not self.target_path.exists():
            raise FileNotFoundError(
                f"Context path does not exist: {self.target_path}\n"
                "For local mode, ensure the path is mounted as a Docker volume "
                "or use NAO_CONTEXT_SOURCE=git for git-based context."
            )

        if not self.validate():
            raise ValueError(
                f"nao_config.yaml not found in {self.target_path}\n"
                "Ensure the context path contains a valid nao project."
            )

    def refresh(self) -> bool:
        """Refresh is a no-op for local provider.

        Local context is managed externally (e.g., volume mount updates).

        Returns:
            False (no refresh performed)
        """
        return False

    def is_initialized(self) -> bool:
        """Check if local context is available.

        Returns:
            True if target path exists and contains nao_config.yaml.
        """
        return self.target_path.exists() and self.validate()
