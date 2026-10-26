import os
import threading
from dataclasses import dataclass
from typing import Any

import requests

from nao_core.auth import clear_stored_auth, get_auth_session, interactive_login, login
from nao_core.config.llm import ModelCosts
from nao_core.config.test import ComparisonConfig
from nao_core.ui import UI

from .assertions import Assertion
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

    data: list[dict[str, Any]] | None
    expectedData: list[dict[str, Any]]
    expectedColumns: list[str]
    sql: str | None = None
    error: str | None = None


@dataclass
class TestVerdict:
    """Pass/fail decision computed by the backend, absent on servers that predate it."""

    passed: bool
    message: str
    comparison: str | None = None


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
    verdict: TestVerdict | None = None


class AgentClientError(Exception):
    """Error from the agent client."""

    pass


class AgentClient:
    """Client for interacting with the nao agent API."""

    def __init__(
        self,
        backend_url: str = BACKEND_URL,
        email: str | None = None,
        password: str | None = None,
        api_key: str | None = None,
        project_name: str | None = None,
    ):
        self.backend_url = backend_url
        self._email = email
        self._password = password
        self._api_key = api_key
        self._project_name = project_name
        self._session: requests.Session | None = None
        self._auth_lock = threading.Lock()
        self._auth_generation = 0
        self._reauth_failed = False

    def _get_session(self) -> tuple[requests.Session, int]:
        """Get or create an authenticated session, with its auth generation."""
        with self._auth_lock:
            if self._session is None:
                self._session = self._create_session()
            return self._session, self._auth_generation

    def _create_session(self) -> requests.Session:
        if not self._api_key:
            return get_auth_session(self.backend_url, email=self._email, password=self._password)

        session = requests.Session()
        session.headers["Authorization"] = f"Bearer {self._api_key}"
        if self._project_name:
            session.headers["x-nao-project-name"] = self._project_name
        return session

    def _handle_auth_retry(self, generation: int) -> bool:
        """Handle 401 by re-authenticating. Only one thread re-authenticates at a time."""
        if self._api_key:
            return False

        with self._auth_lock:
            if self._auth_generation != generation:
                return True
            if self._reauth_failed:
                return False

            UI.warn("Session expired or unauthorized.")
            clear_stored_auth()
            self._session = None

            if self._email and self._password:
                authenticated = login(self.backend_url, self._email, self._password) is not None
            else:
                authenticated = interactive_login(self.backend_url)

            if authenticated:
                self._auth_generation += 1
            else:
                self._reauth_failed = True
            return authenticated

    def run_test(
        self,
        test_case: TestCase,
        provider: str = "openai",
        model_id: str = "gpt-4.1",
        costs: ModelCosts | None = None,
        comparison: ComparisonConfig | None = None,
        retry_auth: bool = True,
    ) -> TestResult:
        """Run a test prompt and return the result."""
        session, auth_generation = self._get_session()
        payload: dict[str, Any] = {
            "model": {
                "provider": provider,
                "modelId": model_id,
            },
            "prompt": test_case.prompt,
        }

        if test_case.sql:
            payload["sql"] = test_case.sql

        if test_case.database:
            payload["databaseId"] = test_case.database

        if test_case.assertions:
            payload["assertions"] = [serialize_assertion(assertion) for assertion in test_case.assertions]

        if comparison is not None:
            payload["comparison"] = comparison.model_dump()

        cost_payload = serialize_model_costs(costs)
        if cost_payload is not None:
            payload["meta"] = {"costs": cost_payload}

        response = session.post(
            f"{self.backend_url}/api/test/run",
            json=payload,
        )

        if response.status_code == 401:
            if retry_auth and self._handle_auth_retry(auth_generation):
                return self.run_test(
                    test_case, provider, model_id, costs=costs, comparison=comparison, retry_auth=False
                )
            raise AgentClientError(
                "Invalid API key." if self._api_key else "Unauthorized. Please check your credentials."
            )

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
            verdict=TestVerdict(**data["verdict"]) if data.get("verdict") else None,
        )


_client: AgentClient | None = None


def get_client(
    email: str | None = None,
    password: str | None = None,
    api_key: str | None = None,
    project_name: str | None = None,
) -> AgentClient:
    """Get or create the module-level agent client."""
    global _client
    if _client is None:
        _client = AgentClient(
            BACKEND_URL,
            email=email,
            password=password,
            api_key=api_key,
            project_name=project_name,
        )
    return _client


def serialize_model_costs(costs: ModelCosts | None) -> dict[str, float] | None:
    """Convert config costs to the backend API shape, omitting the token types left unpriced."""
    if costs is None:
        return None

    priced = {
        "inputNoCache": costs.input_no_cache,
        "inputCacheRead": costs.input_cache_read,
        "inputCacheWrite": costs.input_cache_write,
        "output": costs.output,
    }
    serialized = {key: value for key, value in priced.items() if value is not None}
    return serialized or None


def serialize_assertion(assertion: Assertion) -> dict[str, Any]:
    """Convert an assertion to the backend API shape."""
    serialized: dict[str, Any] = {"type": "tool_call", "tool": assertion.tool, "min_count": assertion.min_count}
    if assertion.args is not None:
        serialized["args"] = assertion.args
    return serialized
