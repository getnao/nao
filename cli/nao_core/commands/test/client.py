import os
from dataclasses import dataclass
from typing import Any

import requests

from nao_core.auth import clear_stored_cookies, get_auth_session, prompt_login
from nao_core.ui import UI

from .case import TestCase

BACKEND_URL = os.getenv("BACKEND_URL", "http://localhost:5005")


@dataclass
class TokenUsage:
    """Token usage from running a test prompt."""

    inputTotalTokens: int | None = None
    inputNoCacheTokens: int | None = None
    inputCacheReadTokens: int | None = None
    inputCacheWriteTokens: int | None = None
    outputTotalTokens: int | None = None
    outputTextTokens: int | None = None
    outputReasoningTokens: int | None = None
    totalTokens: int | None = None


@dataclass
class TokenCost:
    """Token cost from running a test prompt."""

    inputNoCache: float | None = None
    inputCacheRead: float | None = None
    inputCacheWrite: float | None = None
    output: float | None = None
    totalCost: float | None = None


@dataclass
class VerificationResult:
    """Result from running a verification prompt."""

    data: list[dict[str, Any]]
    expectedData: list[dict[str, Any]]
    expectedColumns: list[str]


@dataclass
class TestResult:
    """Result from running a test prompt."""

    text: str
    tool_calls: list[dict[str, Any]]
    usage: TokenUsage
    cost: TokenCost
    finish_reason: str
    duration_ms: int
    verification: VerificationResult | None = None


class AgentClientError(Exception):
    """Error from the agent client."""

    pass


class AgentClient:
    """Client for interacting with the nao agent API."""

    def __init__(self, backend_url: str = BACKEND_URL):
        self.backend_url = backend_url
        self._session: requests.Session | None = None

    def _get_session(self) -> requests.Session:
        """Get or create an authenticated session."""
        if self._session is None:
            self._session = get_auth_session(self.backend_url)
        return self._session

    def _reset_session(self) -> None:
        """Reset the session (used after re-authentication)."""
        self._session = None

    def _handle_auth_retry(self) -> bool:
        """Handle 401 by prompting for login. Returns True if re-auth succeeded."""
        UI.warn("Session expired or unauthorized.")
        clear_stored_cookies()
        self._reset_session()

        cookies = prompt_login(self.backend_url)
        if cookies:
            self._reset_session()
            return True
        return False

    def run_test(
        self,
        test_case: TestCase,
        provider: str = "openai",
        model_id: str = "gpt-4.1",
        retry_auth: bool = True,
    ) -> TestResult:
        """Run a test prompt and return the result."""
        session = self._get_session()

        response = session.post(
            f"{self.backend_url}/api/test/run",
            json={
                "model": {
                    "provider": provider,
                    "modelId": model_id,
                },
                "prompt": test_case.prompt,
                "sql": test_case.sql,
            },
        )

        if response.status_code == 401:
            if retry_auth and self._handle_auth_retry():
                return self.run_test(test_case, provider, model_id, retry_auth=False)
            raise AgentClientError("Unauthorized. Please check your credentials.")

        if response.status_code != 200:
            raise AgentClientError(f"Request failed: {response.status_code} {response.text}")

        data = response.json()
        return TestResult(
            text=data["text"],
            tool_calls=data["toolCalls"],
            usage=TokenUsage(**data["usage"]),
            cost=TokenCost(**data["cost"]),
            finish_reason=data["finishReason"],
            duration_ms=data.get("durationMs", 0),
            verification=VerificationResult(**data["verification"]) if data.get("verification") else None,
        )


_client: AgentClient | None = None


def get_client() -> AgentClient:
    """Get or create the module-level agent client."""
    global _client
    if _client is None:
        _client = AgentClient(BACKEND_URL)
    return _client
