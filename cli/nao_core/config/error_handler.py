"""Error handling utilities for config validation."""

import difflib
from typing import Any

from pydantic import ValidationError


def suggest_similar_fields(field_name: str, valid_fields: list[str], max_suggestions: int = 3) -> list[str]:
    """Suggest similar field names using fuzzy matching.

    Args:
        field_name: The invalid field name
        valid_fields: List of valid field names
        max_suggestions: Maximum number of suggestions to return

    Returns:
        List of similar field names, ordered by similarity
    """
    matches = difflib.get_close_matches(field_name, valid_fields, n=max_suggestions, cutoff=0.6)
    return matches


def get_valid_fields(config_class: type[Any]) -> list[str]:
    """Get the list of valid fields for a config class.

    Args:
        config_class: The Pydantic model class

    Returns:
        List of field names
    """
    if hasattr(config_class, "model_fields"):
        model_fields = getattr(config_class, "model_fields")
        if isinstance(model_fields, dict):
            return list(model_fields.keys())
    return []


def format_validation_error(error: Any, config_class: type[Any]) -> str:
    """Format a single validation error with suggestions.

    Args:
        error: A validation error from pydantic
        config_class: The config class for context

    Returns:
        Formatted error message with suggestions if applicable
    """
    loc_parts = list(error.get("loc", []))
    msg = error.get("msg", "unknown error")
    error_type = error.get("type", "")

    # Build the field path
    if loc_parts:
        field_path = " → ".join(str(p) for p in loc_parts)
    else:
        field_path = "config"

    # Check if this is an "extra fields not permitted" error (wrong field name)
    if error_type in ("extra_forbidden", "value_error.extra", "missing") and loc_parts:
        field_name = str(loc_parts[-1])
        valid_fields = get_valid_fields(config_class)
        suggestions = suggest_similar_fields(field_name, valid_fields)

        if suggestions:
            suggestion_text = ", ".join(f"'{s}'" for s in suggestions)
            return f"{field_path}: unknown field. Did you mean {suggestion_text}? ({msg})"

    # Check if value is empty (likely from empty env var)
    if "Field required" in msg or "field required" in msg.lower():
        return f"{field_path}: field is required (check if environment variable is set and non-empty)"

    return f"{field_path}: {msg}"


def format_all_validation_errors(validation_error: ValidationError, config_class: type[Any]) -> str:
    """Format all validation errors with suggestions.

    Args:
        validation_error: The pydantic ValidationError
        config_class: The config class for context

    Returns:
        Formatted error message string
    """
    error_messages = []

    for error in validation_error.errors():
        formatted = format_validation_error(error, config_class)
        error_messages.append(formatted)

    return "\n  • ".join(error_messages)
