"""Public data types for the nao SDK."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Optional, Union

ModelInput = Union[str, "Model", dict, None]


@dataclass
class Model:
    """A model selection: a provider (e.g. ``openai``) and a model id."""

    provider: str
    model_id: str

    def to_payload(self) -> dict:
        return {"provider": self.provider, "modelId": self.model_id}

    @classmethod
    def from_payload(cls, data: dict) -> "Model":
        return cls(provider=data["provider"], model_id=data.get("modelId") or data.get("model_id"))


@dataclass
class AvailableModel:
    """A model that is activated for a project and can be selected."""

    provider: str
    model_id: str
    name: str

    @classmethod
    def from_payload(cls, data: dict) -> "AvailableModel":
        return cls(
            provider=data["provider"],
            model_id=data.get("modelId") or data.get("model_id"),
            name=data.get("name", ""),
        )


@dataclass
class Project:
    id: str
    name: str

    @classmethod
    def from_payload(cls, data: dict) -> "Project":
        return cls(id=data["id"], name=data.get("name", ""))


@dataclass
class RunResult:
    """The result of a non-streaming agent run."""

    chat_id: str
    text: str
    model: Optional[Model] = None


@dataclass
class StreamEvent:
    """A single event emitted while streaming an agent run.

    ``type`` is one of ``message_start``, ``text``, ``tool``,
    ``message_complete`` or ``error``. Other fields are populated
    depending on the event type.
    """

    type: str
    text: Optional[str] = None
    name: Optional[str] = None
    status: Optional[str] = None
    chat_id: Optional[str] = None
    model: Optional[Model] = None
    error: Optional[str] = None


def normalize_model(model: ModelInput) -> Optional[dict]:
    """Coerce a user-supplied model into the wire payload, or ``None``."""
    if model is None:
        return None
    if isinstance(model, Model):
        return model.to_payload()
    if isinstance(model, dict):
        provider = model.get("provider")
        model_id = model.get("modelId") or model.get("model_id")
        if not provider or not model_id:
            raise ValueError("model dict must contain 'provider' and 'modelId'")
        return {"provider": provider, "modelId": model_id}
    if isinstance(model, str):
        for sep in (":", "/"):
            if sep in model:
                provider, model_id = model.split(sep, 1)
                return {"provider": provider.strip(), "modelId": model_id.strip()}
        raise ValueError("model string must look like 'provider:model-id' (e.g. 'openai:gpt-4o')")
    raise TypeError(f"Unsupported model type: {type(model)!r}")
