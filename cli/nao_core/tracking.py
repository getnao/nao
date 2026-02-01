"""PostHog analytics tracking for nao CLI.

This module provides opt-in analytics tracking to help improve nao.
Tracking is disabled by default unless POSTHOG_API_KEY is set.
"""

import atexit
import os
import platform
import uuid
from functools import wraps
from pathlib import Path
from typing import Any, Callable, TypeVar

import posthog

# PostHog configuration from environment
POSTHOG_API_KEY = os.environ.get("VITE_PUBLIC_POSTHOG_KEY", "")
POSTHOG_HOST = os.environ.get("VITE_PUBLIC_POSTHOG_HOST", "https://us.i.posthog.com")

# File to persist anonymous distinct_id across CLI invocations
DISTINCT_ID_FILE = Path.home() / ".nao" / "distinct_id"

# Track whether PostHog has been initialized
_initialized = False


def _get_or_create_distinct_id() -> str:
    """Get or create a persistent anonymous distinct ID for this user."""
    try:
        # Try to read existing ID
        if DISTINCT_ID_FILE.exists():
            existing_id = DISTINCT_ID_FILE.read_text().strip()
            if existing_id:
                return existing_id

        # Create new ID and persist it
        new_id = str(uuid.uuid4())
        DISTINCT_ID_FILE.parent.mkdir(parents=True, exist_ok=True)
        DISTINCT_ID_FILE.write_text(new_id)
        return new_id
    except Exception:
        # If we can't persist, generate a new ID each time
        return str(uuid.uuid4())


def _get_system_properties() -> dict[str, Any]:
    """Get system properties for event context."""
    return {
        "os": platform.system(),
        "os_version": platform.release(),
        "python_version": platform.python_version(),
        "cli_source": "nao-core",
    }


def init_tracking() -> None:
    """Initialize PostHog tracking if API key is configured."""
    global _initialized

    if _initialized:
        return

    if not POSTHOG_API_KEY:
        return

    try:
        posthog.project_api_key = POSTHOG_API_KEY  # type: ignore[assignment]
        posthog.host = POSTHOG_HOST  # type: ignore[assignment]
        posthog.debug = os.environ.get("POSTHOG_DEBUG", "").lower() == "true"  # type: ignore[assignment]

        # Disable automatic capture - only explicit events
        posthog.disabled = False

        # Register shutdown handler to flush events
        atexit.register(shutdown_tracking)

        _initialized = True
    except Exception:
        # Silently fail - tracking should never break the CLI
        pass


def shutdown_tracking() -> None:
    """Flush and shutdown PostHog client."""
    if not _initialized:
        return

    try:
        posthog.flush()
        posthog.shutdown()
    except Exception:
        pass


def capture(event: str, properties: dict[str, Any] | None = None) -> None:
    """Capture an analytics event.

    Args:
        event: The event name (e.g., "cli_command_started")
        properties: Additional properties to attach to the event
    """
    if not POSTHOG_API_KEY:
        return

    init_tracking()

    if not _initialized:
        return

    try:
        distinct_id = _get_or_create_distinct_id()
        event_properties = _get_system_properties()

        if properties:
            event_properties.update(properties)

        posthog.capture(distinct_id=distinct_id, event=event, properties=event_properties)
    except Exception:
        pass


def identify(properties: dict[str, Any] | None = None) -> None:
    """Identify the current user with additional properties.

    Args:
        properties: User properties to set
    """
    if not POSTHOG_API_KEY:
        return

    init_tracking()

    if not _initialized:
        return

    try:
        distinct_id = _get_or_create_distinct_id()
        posthog.identify_context(distinct_id=distinct_id)
    except Exception:
        pass


# Type variable for decorator
F = TypeVar("F", bound=Callable[..., Any])


def track_command(command_name: str) -> Callable[[F], F]:
    """Decorator to track command execution.

    Args:
        command_name: The name of the command being tracked

    Usage:
        @track_command("chat")
        def chat():
            ...
    """

    def decorator(func: F) -> F:
        @wraps(func)
        def wrapper(*args: Any, **kwargs: Any) -> Any:
            # Capture command start
            capture(
                "cli_command_started",
                {
                    "command": command_name,
                },
            )

            try:
                result = func(*args, **kwargs)

                # Capture command success
                capture(
                    "cli_command_completed",
                    {
                        "command": command_name,
                        "status": "success",
                    },
                )

                return result
            except KeyboardInterrupt:
                # User cancelled - don't track as error
                capture(
                    "cli_command_completed",
                    {
                        "command": command_name,
                        "status": "cancelled",
                    },
                )
                raise
            except Exception as e:
                # Capture command failure
                capture(
                    "cli_command_completed",
                    {
                        "command": command_name,
                        "status": "error",
                        "error_type": type(e).__name__,
                    },
                )
                raise

        return wrapper  # type: ignore

    return decorator
