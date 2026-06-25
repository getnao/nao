"""Synchronous client for the nao analytics agent."""

from __future__ import annotations

import json
from typing import Iterator, List, Optional

import requests

from ._errors import NaoAPIError
from .types import (
    AvailableModel,
    Model,
    ModelInput,
    Project,
    RunResult,
    StreamEvent,
    normalize_model,
)

DEFAULT_BASE_URL = "http://localhost:5005"
DEFAULT_TIMEOUT = 600


class Nao:
    """A client for the nao agent.

    Example:
        >>> from nao_sdk import Nao
        >>> client = Nao(api_key="nao_...")
        >>> result = client.run("How many orders were placed last month?")
        >>> print(result.text)
    """

    def __init__(
        self,
        api_key: str,
        *,
        base_url: str = DEFAULT_BASE_URL,
        project_id: Optional[str] = None,
        model: ModelInput = None,
        timeout: float = DEFAULT_TIMEOUT,
    ):
        if not api_key:
            raise ValueError("api_key is required")
        self.api_key = api_key
        self.base_url = base_url.rstrip("/")
        self.default_project_id = project_id
        self.default_model = model
        self.timeout = timeout
        self._session = requests.Session()

    def run(
        self,
        prompt: str,
        *,
        chat_id: Optional[str] = None,
        project_id: Optional[str] = None,
        model: ModelInput = None,
    ) -> RunResult:
        """Send a prompt and return the agent's full response once complete."""
        payload = self._build_payload(prompt, chat_id, project_id, model)
        response = self._session.post(
            f"{self.base_url}/api/v1/agent",
            headers=self._headers(),
            json=payload,
            timeout=self.timeout,
        )
        data = self._parse_json(response)
        return RunResult(
            chat_id=data["chatId"],
            text=data.get("text", ""),
            model=Model.from_payload(data["model"]) if data.get("model") else None,
        )

    def stream(
        self,
        prompt: str,
        *,
        chat_id: Optional[str] = None,
        project_id: Optional[str] = None,
        model: ModelInput = None,
    ) -> Iterator[StreamEvent]:
        """Send a prompt and yield events as the agent responds."""
        payload = self._build_payload(prompt, chat_id, project_id, model)
        with self._session.post(
            f"{self.base_url}/api/v1/agent/stream",
            headers={**self._headers(), "Accept": "text/event-stream"},
            json=payload,
            stream=True,
            timeout=self.timeout,
        ) as response:
            if response.status_code >= 400:
                raise NaoAPIError(self._error_text(response), response.status_code)
            yield from _parse_sse(response)

    def models(self, *, project_id: Optional[str] = None) -> List[AvailableModel]:
        """List the models activated for a project."""
        params = {}
        pid = project_id or self.default_project_id
        if pid:
            params["projectId"] = pid
        response = self._session.get(
            f"{self.base_url}/api/v1/models",
            headers=self._headers(),
            params=params,
            timeout=self.timeout,
        )
        data = self._parse_json(response)
        return [AvailableModel.from_payload(m) for m in data.get("models", [])]

    def projects(self) -> List[Project]:
        """List the projects available to this API key's organization."""
        response = self._session.get(
            f"{self.base_url}/api/v1/projects",
            headers=self._headers(),
            timeout=self.timeout,
        )
        data = self._parse_json(response)
        return [Project.from_payload(p) for p in data.get("projects", [])]

    def _build_payload(
        self,
        prompt: str,
        chat_id: Optional[str],
        project_id: Optional[str],
        model: ModelInput,
    ) -> dict:
        if not prompt:
            raise ValueError("prompt must not be empty")
        payload: dict = {"prompt": prompt}
        if chat_id:
            payload["chatId"] = chat_id
        resolved_project = project_id or self.default_project_id
        if resolved_project:
            payload["projectId"] = resolved_project
        resolved_model = normalize_model(model if model is not None else self.default_model)
        if resolved_model:
            payload["model"] = resolved_model
        return payload

    def _headers(self) -> dict:
        return {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
        }

    def _parse_json(self, response: requests.Response) -> dict:
        if response.status_code >= 400:
            raise NaoAPIError(self._error_text(response), response.status_code)
        return response.json()

    @staticmethod
    def _error_text(response: requests.Response) -> str:
        try:
            body = response.json()
            if isinstance(body, dict) and body.get("error"):
                return str(body["error"])
            if isinstance(body, dict) and body.get("message"):
                return str(body["message"])
        except ValueError:
            pass
        return response.text or f"Request failed with status {response.status_code}"


def _parse_sse(response: requests.Response) -> Iterator[StreamEvent]:
    """Parse a Server-Sent Events stream into :class:`StreamEvent` objects."""
    event = None
    for raw_line in response.iter_lines(decode_unicode=True):
        if raw_line is None:
            continue
        line = raw_line.rstrip("\r")
        if line == "":
            event = None
            continue
        if line.startswith("event:"):
            event = line[len("event:") :].strip()
        elif line.startswith("data:"):
            data = line[len("data:") :].strip()
            yield _build_event(event, data)


def _build_event(event: Optional[str], data: str) -> StreamEvent:
    try:
        parsed = json.loads(data) if data else {}
    except ValueError:
        parsed = {}
    model = Model.from_payload(parsed["model"]) if parsed.get("model") else None
    return StreamEvent(
        type=event or "message",
        text=parsed.get("text"),
        name=parsed.get("name"),
        status=parsed.get("status"),
        chat_id=parsed.get("chatId"),
        model=model,
        error=parsed.get("error"),
    )
