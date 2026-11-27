"""Keep warehouse credentials out of driver errors that reach users, the agent and the logs."""

import re
from urllib.parse import quote

from pydantic import BaseModel

REDACTED = "[redacted]"
AUTHENTICATION_FAILED_MESSAGE = "Authentication to the warehouse failed, check the connection credentials."

_SECRET_FIELD_PATTERN = re.compile(r"pass|secret|token|private_key|access_key|key_id|credential", re.IGNORECASE)
_URL_CREDENTIALS_PATTERN = re.compile(r"(\b[a-z][a-z0-9+.-]*://[^\s:/@]*:)\S*@", re.IGNORECASE)
_KEY_VALUE_SECRET_PATTERN = re.compile(
    r"\b(\w*(?:password|passwd|pwd|passphrase|secret|token|api_?key|private_?key|access_?key)\w*)"
    r"(\s*(?:=|:(?!:))\s*)"
    r"(\"[^\"]*\"|'[^']*'|\{[^}]*\}|[^\s;,&'\"]+)",
    re.IGNORECASE,
)
_BEARER_TOKEN_PATTERN = re.compile(r"\b(Bearer\s+)[\w\-.~+/]+=*", re.IGNORECASE)
_AUTHENTICATION_FAILURE_PATTERN = re.compile(
    r"authentication failed|access denied for user|login failed for user|"
    r"incorrect username or password|invalid (?:username|user name|login|credentials|password|access token)|"
    r"password is incorrect|wrong password|invalid_grant|unauthorized",
    re.IGNORECASE,
)


def redact_warehouse_error(message: str, config: BaseModel | None = None) -> str:
    """Redact the config's credential values and anything shaped like a password, token or connection string."""
    for secret in sorted(_configured_secret_variants(config), key=lambda value: len(value), reverse=True):
        message = message.replace(secret, REDACTED)
    message = _URL_CREDENTIALS_PATTERN.sub(rf"\1{REDACTED}@", message)
    message = _KEY_VALUE_SECRET_PATTERN.sub(rf"\1\2{REDACTED}", message)
    return _BEARER_TOKEN_PATTERN.sub(rf"\1{REDACTED}", message)


def is_authentication_error(message: str) -> bool:
    return bool(_AUTHENTICATION_FAILURE_PATTERN.search(message))


def _configured_secret_variants(config: BaseModel | None) -> set[str]:
    secrets: set[str] = set()
    if config is not None:
        _collect_secret_values(config, is_secret=False, secrets=secrets)
    return secrets | {quote(secret, safe="") for secret in secrets}


def _collect_secret_values(value: object, *, is_secret: bool, secrets: set[str]) -> None:
    if isinstance(value, BaseModel):
        items = [(name, getattr(value, name, None)) for name in type(value).model_fields]
    elif isinstance(value, dict):
        items = list(value.items())
    elif isinstance(value, (list, tuple)):
        for item in value:
            _collect_secret_values(item, is_secret=is_secret, secrets=secrets)
        return
    else:
        if is_secret and isinstance(value, str) and value.strip():
            secrets.add(value)
        return
    for key, item in items:
        _collect_secret_values(item, is_secret=bool(_SECRET_FIELD_PATTERN.search(str(key))), secrets=secrets)
