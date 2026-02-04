"""PostHog analytics tracking for nao CLI.

This module provides analytics tracking to help improve nao.
Tracking is enabled when POSTHOG_DISABLED is not 'true' AND both POSTHOG_KEY and POSTHOG_HOST are configured.
"""

import atexit
import os
import uuid
from functools import wraps
from pathlib import Path
from typing import Any, Callable, TypeVar

from posthog import Posthog

from nao_core.mode import MODE

POSTHOG_DISABLED = os.environ.get("POSTHOG_DISABLED", "false").lower() == "true"
POSTHOG_KEY = os.environ.get("POSTHOG_KEY", "phc_TUN2TvdA5qjeDFU1XFVCmD3hoVk1dmWree4cWb0dNk4")
POSTHOG_HOST = os.environ.get("POSTHOG_HOST", "https://eu.i.posthog.com")

# PostHog client instance (initialized lazily)
_client: Posthog | None = None

# File to persist anonymous distinct_id across CLI invocations
DISTINCT_ID_FILE = Path.home() / ".nao" / "distinct_id"


def get_or_create_distinct_id() -> str:
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


def get_or_create_posthog_client() -> Posthog | None:
    """Initialize PostHog tracking if enabled and configured."""
    global _client

    if _client is not None:
        return _client

    if POSTHOG_DISABLED or not POSTHOG_KEY or not POSTHOG_HOST or MODE == "dev":
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
        _client.shutdown()
    except Exception:
        pass


# Type variable for decorator
F = TypeVar("F", bound=Callable[..., Any])


def track_command(command_name: str) -> Callable[[F], F]:
    """Decorator to track command execution.

    Captures cli_command_started and cli_command_completed events with:
    - Persistent distinct_id (stored in ~/.nao/distinct_id)
    - Session ID to group events from this invocation
    - System properties (os, os_version, python_version)
    - Command name and completion status

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
            import time

            client = get_or_create_posthog_client()
            if client is None:
                # Tracking disabled, just run the function
                return func(*args, **kwargs)

            # Build properties with system info and command name
            distinct_id = get_or_create_distinct_id()
            session_id = str(uuid.uuid4())
            base_properties = {
                "command": command_name,
                "$session_id": session_id,
                "mode": MODE,
            }

            # Helper to safely capture events (never raises)
            def safe_capture(event: str, extra_properties: dict[str, Any] = {}) -> None:
                try:
                    props = {**base_properties, **extra_properties}
                    client.capture(distinct_id=distinct_id, event=event, properties=props)
                except Exception:
                    pass  # Tracking should never break the CLI

            safe_capture("cli_command_started")
            start_time = time.time()

            try:
                result = func(*args, **kwargs)
                duration_seconds = time.time() - start_time
                safe_capture("cli_command_completed", {"status": "success", "duration_seconds": duration_seconds})
                return result
            except KeyboardInterrupt:
                duration_seconds = time.time() - start_time
                safe_capture("cli_command_completed", {"status": "cancelled", "duration_seconds": duration_seconds})
                raise
            except Exception as e:
                duration_seconds = time.time() - start_time
                safe_capture(
                    "cli_command_completed",
                    {"status": "error", "error_type": type(e).__name__, "duration_seconds": duration_seconds},
                )
                raise

        return wrapper  # type: ignore

    return decorator
