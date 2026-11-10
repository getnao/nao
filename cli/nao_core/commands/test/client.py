import os
import threading
from dataclasses import dataclass, fields
from typing import Any, TypeVar

import requests

from nao_core.auth import clear_stored_auth, get_auth_session, interactive_login, login
from nao_core.config.llm import ModelCosts
from nao_core.config.test import ComparisonConfig
from nao_core.ui import UI

from .assertions import Assertion
from .case import TestCase
from .harnesses import HarnessRun

BACKEND_URL = os.getenv("BACKEND_URL", "http://localhost:5005")

DataclassT = TypeVar("DataclassT")
_UNSET = object()


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


@dataclass(frozen=True)
class ExternalTestAttempt:
    """A server-created MCP endpoint and credential scoped to one test attempt."""

    attempt_id: str
    mcp_url: str
    access_token: str


@dataclass(frozen=True)
class ExternalVerificationRequest:
    """A prompt the same external harness must answer before nao can compare results."""

    prompt: str


class AgentClientError(Exception):
    """Error from the agent client."""


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
        reasoning_effort: str | None = None,
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

        if reasoning_effort:
            payload["model"]["reasoningEffort"] = reasoning_effort

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
                    test_case,
                    provider,
                    model_id,
                    costs=costs,
                    comparison=comparison,
                    reasoning_effort=reasoning_effort,
                    retry_auth=False,
                )
            raise AgentClientError(
                "Invalid API key." if self._api_key else "Unauthorized. Please check your credentials."
            )

        if response.status_code != 200:
            raise AgentClientError(f"Request failed: {response.status_code} {response.text}")

        return parse_test_result(response.json())

    def start_external_test(self, retry_auth: bool = True) -> ExternalTestAttempt:
        """Create an attempt-scoped credential for a context-layer MCP test."""
        response = self._post_external("/api/test/external/start", {}, retry_auth)
        data = response.json()
        return ExternalTestAttempt(
            attempt_id=data["attemptId"],
            mcp_url=data["mcpUrl"],
            access_token=data["accessToken"],
        )

    def evaluate_external_test(
        self,
        attempt: ExternalTestAttempt,
        test_case: TestCase,
        run: HarnessRun,
        comparison: ComparisonConfig | None = None,
        verification_sql: str | None | object = _UNSET,
        retry_auth: bool = True,
    ) -> TestResult | ExternalVerificationRequest:
        """Evaluate calls captured from an external harness, requesting verification SQL when needed."""
        payload: dict[str, Any] = {
            "attemptId": attempt.attempt_id,
            "prompt": test_case.prompt,
            "answer": run.text,
            "run": {
                "usage": run.usage,
                "cost": run.cost,
                "finishReason": run.finish_reason,
                "durationMs": run.duration_ms,
            },
        }
        if test_case.sql:
            payload["sql"] = test_case.sql
        if test_case.database:
            payload["databaseId"] = test_case.database
        if test_case.assertions:
            payload["assertions"] = [serialize_assertion(assertion) for assertion in test_case.assertions]
        if comparison is not None:
            payload["comparison"] = comparison.model_dump()
        if verification_sql is not _UNSET:
            payload["verificationSql"] = verification_sql

        response = self._post_external("/api/test/external/evaluate", payload, retry_auth)
        data = response.json()
        if data.get("status") == "verification_required":
            return ExternalVerificationRequest(prompt=data["prompt"])
        if data.get("status") != "complete":
            raise AgentClientError(f"Unexpected external evaluation response: {data}")
        return parse_test_result(data)

    def _post_external(self, path: str, payload: dict[str, Any], retry_auth: bool) -> requests.Response:
        """POST an external-harness request with the same one-time auth retry as normal tests."""
        session, auth_generation = self._get_session()
        response = session.post(f"{self.backend_url}{path}", json=payload)
        if response.status_code == 401:
            if retry_auth and self._handle_auth_retry(auth_generation):
                return self._post_external(path, payload, retry_auth=False)
            raise AgentClientError(
                "Invalid API key." if self._api_key else "Unauthorized. Please check your credentials."
            )
        if response.status_code != 200:
            raise AgentClientError(f"Request failed: {response.status_code} {response.text}")
        return response

    def get_reasoning_efforts(self, provider: str, model_id: str, retry_auth: bool = True) -> list[str]:
        """List the reasoning efforts the backend can run a model at, from the lowest."""
        session, auth_generation = self._get_session()
        response = session.get(
            f"{self.backend_url}/api/test/reasoning-efforts",
            params={"provider": provider, "modelId": model_id},
        )

        if response.status_code == 401:
            if retry_auth and self._handle_auth_retry(auth_generation):
                return self.get_reasoning_efforts(provider, model_id, retry_auth=False)
            raise AgentClientError(
                "Invalid API key." if self._api_key else "Unauthorized. Please check your credentials."
            )

        if response.status_code == 404:
            raise AgentClientError("This nao server cannot run models at reasoning efforts, update it first.")

        if response.status_code != 200:
            raise AgentClientError(f"Request failed: {response.status_code} {response.text}")

        return response.json()["reasoningEfforts"]


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


def from_known_fields(cls: type[DataclassT], data: dict[str, Any]) -> DataclassT:
    """Build a dataclass from an API payload, ignoring the fields newer servers add."""
    known_fields = {field.name for field in fields(cls)}
    return cls(**{key: value for key, value in data.items() if key in known_fields})


def parse_test_result(data: dict[str, Any]) -> TestResult:
    """Parse the response shared by nao's built-in and external test runners."""
    return TestResult(
        text=data["text"],
        tool_calls=data["toolCalls"],
        usage=from_known_fields(TokenUsage, data.get("usage", {})),
        cost=from_known_fields(TokenCost, data.get("cost", {})),
        finish_reason=data["finishReason"],
        duration_ms=data.get("durationMs", 0),
        verification=from_known_fields(VerificationResult, data["verification"]) if data.get("verification") else None,
        verdict=from_known_fields(TestVerdict, data["verdict"]) if data.get("verdict") else None,
    )
