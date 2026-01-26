"""Context provider module for loading nao project context from various sources."""

import os
from pathlib import Path

from .base import ContextProvider
from .git import GitContextProvider
from .local import LocalContextProvider


def get_context_provider() -> ContextProvider:
    """Factory function to create the appropriate context provider based on environment variables.

    Environment variables:
        NAO_CONTEXT_SOURCE: 'local' (default) or 'git'
        NAO_DEFAULT_PROJECT_PATH: Target path for context (required)

    For git source:
        NAO_CONTEXT_GIT_URL: Git repository URL (required)
        NAO_CONTEXT_GIT_BRANCH: Branch to clone/pull (default: 'main')
        NAO_CONTEXT_GIT_TOKEN: Auth token for private repos (optional)

    Returns:
        ContextProvider instance based on configuration
    """
    source = os.environ.get("NAO_CONTEXT_SOURCE", "local").lower()
    target_path = Path(os.environ.get("NAO_DEFAULT_PROJECT_PATH", "/app/context"))

    if source == "git":
        git_url = os.environ.get("NAO_CONTEXT_GIT_URL")
        if not git_url:
            raise ValueError("NAO_CONTEXT_GIT_URL is required when NAO_CONTEXT_SOURCE=git")

        branch = os.environ.get("NAO_CONTEXT_GIT_BRANCH", "main")
        token = os.environ.get("NAO_CONTEXT_GIT_TOKEN")

        return GitContextProvider(
            repo_url=git_url,
            target_path=target_path,
            branch=branch,
            token=token,
        )
    elif source == "local":
        return LocalContextProvider(target_path=target_path)
    else:
        raise ValueError(f"Unknown NAO_CONTEXT_SOURCE: {source}. Must be 'local' or 'git'")


__all__ = [
    "ContextProvider",
    "GitContextProvider",
    "LocalContextProvider",
    "get_context_provider",
]
