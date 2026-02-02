"""PostHog analytics tracking for nao CLI.

This module provides analytics tracking to help improve nao.
Tracking is enabled when POSTHOG_DISABLED is not 'true' AND both POSTHOG_KEY and POSTHOG_HOST are configured.
"""

import atexit
import os
import platform
import uuid
from functools import wraps
from pathlib import Path
from typing import Any, Callable, TypeVar

import posthog
from posthog import Posthog

# PostHog configuration from environment
POSTHOG_DISABLED = os.environ.get("POSTHOG_DISABLED", "false").lower() == "true"
POSTHOG_KEY = os.environ.get("POSTHOG_KEY", "")
POSTHOG_HOST = os.environ.get("POSTHOG_HOST", "")

# PostHog client instance (initialized lazily)
_client: Posthog | None = None

# File to persist anonymous distinct_id across CLI invocations
DISTINCT_ID_FILE = Path.home() / ".nao" / "distinct_id"


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
    }


def get_or_create_posthog_client() -> Posthog | None:
    """Initialize PostHog tracking if enabled and configured."""
    global _client

    if _client is not None:
        return _client

    # Skip if disabled or missing configuration
    if POSTHOG_DISABLED or not POSTHOG_KEY or not POSTHOG_HOST:
        return None

    try:
        # Initialize PostHog client
        _client = Posthog(
            POSTHOG_KEY,
            host=POSTHOG_HOST,
            debug=os.environ.get("POSTHOG_DEBUG", "").lower() == "true",
        )

        # Register shutdown handler to flush events
        atexit.register(shutdown_tracking)
    except Exception:
        # Silently fail - tracking should never break the CLI
        pass

    return _client


def shutdown_tracking() -> None:
    """Flush and shutdown PostHog client."""
    if _client is None:
        return

    try:
        _client.flush()
        _client.shutdown()
    except Exception:
        pass


# Type variable for decorator
F = TypeVar("F", bound=Callable[..., Any])


def track_command(command_name: str) -> Callable[[F], F]:
    """Decorator to track command execution using PostHog's context API.

    Creates a context for the command execution that automatically:
    - Sets the distinct_id for all events
    - Sets a session ID to group events from this invocation
    - Tags all events with system properties and command name

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
            client = get_or_create_posthog_client()
            if client is None:
                # Tracking disabled, just run the function
                return func(*args, **kwargs)

            try:
                with posthog.new_context(client=client, capture_exceptions=False):
                    # Set distinct ID for all events in this context
                    posthog.identify_context(_get_or_create_distinct_id())

                    # Set a session ID to group events from this CLI invocation
                    session_id = str(uuid.uuid4())
                    posthog.set_context_session(session_id)

                    # Tag all events with system properties and command name
                    for key, value in _get_system_properties().items():
                        posthog.tag(key, value)
                    posthog.tag("command", command_name)

                    # Capture command start
                    posthog.capture("cli_command_started")

                    try:
                        result = func(*args, **kwargs)

                        # Capture command success
                        posthog.capture("cli_command_completed", properties={"status": "success"})

                        return result
                    except KeyboardInterrupt:
                        # User cancelled - don't track as error
                        posthog.capture("cli_command_completed", properties={"status": "cancelled"})
                        raise
                    except Exception as e:
                        # Capture command failure
                        posthog.capture(
                            "cli_command_completed",
                            properties={"status": "error", "error_type": type(e).__name__},
                        )
                        raise
            except Exception:
                # If tracking itself fails, just run the function
                return func(*args, **kwargs)

        return wrapper  # type: ignore

    return decorator
