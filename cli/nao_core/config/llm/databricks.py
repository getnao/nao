"""Databricks Model Serving: the workspace serving endpoints, called through their OpenAI-compatible API."""

from __future__ import annotations

import re
from typing import TYPE_CHECKING, Any
from urllib.parse import urlsplit

import httpx

if TYPE_CHECKING:
    from nao_core.config.llm import ProviderConfig

"""The serving endpoint task of chat models; embeddings, completions and custom models answer other tasks."""
CHAT_TASK = "llm/v1/chat"
TIMEOUT_SECONDS = 30


def list_chat_endpoints(config: ProviderConfig) -> list[str]:
    """Names of the workspace serving endpoints that answer chat completions, usable as models."""
    response = httpx.get(
        f"{workspace_url(config)}/api/2.0/serving-endpoints",
        headers={"Authorization": f"Bearer {access_token(config)}"},
        timeout=TIMEOUT_SECONDS,
    )
    response.raise_for_status()
    endpoints = response.json().get("endpoints", [])
    return sorted(endpoint["name"] for endpoint in endpoints if endpoint.get("task") == CHAT_TASK)


def openai_client(config: ProviderConfig) -> Any:
    from nao_core.deps import require_dependency

    require_dependency("openai", "openai", "for the Databricks LLM provider")
    from openai import OpenAI

    return OpenAI(api_key=access_token(config), base_url=f"{workspace_url(config)}/serving-endpoints")


def access_token(config: ProviderConfig) -> str:
    """The personal access token, else a token issued to the service principal (OAuth machine-to-machine)."""
    if config.api_key:
        return config.api_key
    if not (config.client_id and config.client_secret):
        raise ValueError("Databricks needs an api_key (personal access token) or a client_id and client_secret")

    response = httpx.post(
        f"{workspace_url(config)}/oidc/v1/token",
        auth=(config.client_id, config.client_secret),
        data={"grant_type": "client_credentials", "scope": "all-apis"},
        timeout=TIMEOUT_SECONDS,
    )
    response.raise_for_status()
    return response.json()["access_token"]


def workspace_url(config: ProviderConfig) -> str:
    """The workspace origin, so a URL pasted with a path such as `/serving-endpoints` or `?o=` still works."""
    if not config.base_url:
        raise ValueError("base_url (the Databricks workspace URL) is not set")
    url = config.base_url if re.match(r"^https?://", config.base_url, re.IGNORECASE) else f"https://{config.base_url}"
    parts = urlsplit(url)
    if parts.scheme.lower() != "https":
        raise ValueError("base_url (the Databricks workspace URL) must use https")
    return f"https://{parts.netloc}"
