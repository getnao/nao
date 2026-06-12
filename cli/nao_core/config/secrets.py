"""Secret resolution for ``nao_config.yaml``.

Supports template-style references that are substituted before YAML parsing:

    {{ env('VAR_NAME') }}                        # OS environment variable
    {{ aws('secret_name/path.to.field') }}       # AWS Secrets Manager (JSON payload, glom path)
    {{ k8s('namespace/secret/field') }}          # Kubernetes Secret

Each reference resolves to a string. ``env`` follows the long-standing lenient
behaviour (missing variables become empty strings and are reported as warnings
during config validation); ``aws`` and ``k8s`` raise ``ValueError`` on failure
so the user gets an immediate, actionable error rather than a confusing
downstream pydantic validation message.

AWS payloads are JSON; the part after the first ``/`` is a glom path, so
nested fields are addressed with dot-notation::

    secret payload: {"port": 5432, "cred": {"user": "potato"}}
    aws('id/port')           → "5432"
    aws('id/cred.user')      → "potato"

When the same secret is referenced more than once in a single config load,
the underlying AWS / k8s call is made only once -- the parsed payload is
cached for the duration of :func:`process_secrets`.
"""

from __future__ import annotations

import base64
import json
import os
import re
from typing import Any

from nao_core.deps import require_dependency

_TEMPLATE_REGEX = re.compile(r"\$?\{\{\s*(?P<protocol>env|aws|k8s)\(\s*['\"](?P<identifier>[^'\"]+)['\"]\s*\)\s*\}\}")

_AWS_ARN_REGION_REGEX = re.compile(r"^arn:aws:secretsmanager:(?P<region>[\w-]+):")

_K8S_NAMESPACE_FILE = "/var/run/secrets/kubernetes.io/serviceaccount/namespace"

_SCALAR_TYPES = (str, int, float, bool)

SecretCache = dict[tuple[str, str], Any]


def process_secrets(
    content: str,
    extra_env: dict[str, str] | None = None,
) -> tuple[str, dict[str, str | None]]:
    """Substitute every secret reference in *content*.

    Returns the rendered content and a map of references that resolved to
    ``None``. Only ``env`` can produce missing entries; ``aws`` and ``k8s``
    raise ``ValueError`` instead of silently substituting empty strings.

    Repeated references to the same AWS / k8s secret hit the backend once;
    subsequent references reuse the cached payload.
    """
    missing: dict[str, str | None] = {}
    cache: SecretCache = {}

    def replacer(match: re.Match[str]) -> str:
        protocol = match.group("protocol")
        identifier = match.group("identifier")

        if protocol == "env":
            value = resolve_env(identifier, extra_env=extra_env)
            if value is None:
                missing[identifier] = None
                return ""
            return value

        if protocol == "aws":
            return resolve_aws(identifier, cache=cache)

        # The regex restricts protocols to (env|aws|k8s); anything else is a bug.
        assert protocol == "k8s", f"Unexpected protocol: {protocol!r}"
        return resolve_k8s(identifier, cache=cache)

    return _TEMPLATE_REGEX.sub(replacer, content), missing


def resolve_env(identifier: str, extra_env: dict[str, str] | None = None) -> str | None:
    """Look up *identifier* in *extra_env* first, then ``os.environ``."""
    if extra_env is not None and identifier in extra_env:
        value = extra_env[identifier]
    else:
        value = os.environ.get(identifier)
    return value or None


def resolve_aws(identifier: str, cache: SecretCache | None = None) -> str:
    """Fetch a (possibly nested) field from an AWS Secrets Manager JSON secret.

    Identifier formats:
        ``secret_name/field``                       — top-level JSON key
        ``secret_name/nested.field.path``           — glom dot-path
        ``arn:aws:secretsmanager:<region>:<account>:secret:<name>/field``
    """
    secret_name, field_path = _split_aws_identifier(identifier)
    payload = _load_aws_payload(secret_name, cache=cache)
    return _extract_scalar(payload, field_path, source=f"AWS secret '{secret_name}'")


def resolve_k8s(identifier: str, cache: SecretCache | None = None) -> str:
    """Fetch a field from a Kubernetes Secret.

    Identifier formats:
        ``secret_name/field``                  (uses the pod namespace)
        ``namespace/secret_name/field``        (explicit namespace)
    """
    namespace, secret_name, field = _split_k8s_identifier(identifier)
    data = _load_k8s_data(namespace, secret_name, cache=cache)
    if field not in data:
        raise ValueError(f"Kubernetes secret '{namespace}/{secret_name}' has no field '{field}'")
    return base64.b64decode(data[field]).decode("utf-8")


def _load_aws_payload(secret_name: str, cache: SecretCache | None) -> dict[str, Any]:
    key = ("aws", secret_name)
    if cache is not None and key in cache:
        return cache[key]

    require_dependency("boto3", "aws-secrets", "for AWS Secrets Manager resolution")
    import boto3
    from botocore.exceptions import BotoCoreError, ClientError

    region = _aws_region_from_arn(secret_name)
    try:
        client = boto3.session.Session(region_name=region).client(service_name="secretsmanager")
        response = client.get_secret_value(SecretId=secret_name)
    except (BotoCoreError, ClientError) as e:
        raise ValueError(f"Failed to load AWS secret '{secret_name}': {e}") from e

    secret_str = response.get("SecretString")
    if not secret_str:
        raise ValueError(f"AWS secret '{secret_name}' has no SecretString payload (binary secrets are not supported)")

    try:
        payload = json.loads(secret_str)
    except json.JSONDecodeError as e:
        raise ValueError(f"AWS secret '{secret_name}' is not valid JSON: {e}") from e

    if not isinstance(payload, dict):
        raise ValueError(f"AWS secret '{secret_name}' payload is not a JSON object")

    if cache is not None:
        cache[key] = payload
    return payload


def _load_k8s_data(namespace: str, secret_name: str, cache: SecretCache | None) -> dict[str, str]:
    key = ("k8s", f"{namespace}/{secret_name}")
    if cache is not None and key in cache:
        return cache[key]

    require_dependency("kubernetes", "k8s-secrets", "for Kubernetes Secret resolution")
    from kubernetes import client as kube_client  # ty: ignore[unresolved-import]

    _load_kube_config()
    try:
        secret = kube_client.CoreV1Api().read_namespaced_secret(name=secret_name, namespace=namespace)
    except Exception as e:
        raise ValueError(f"Failed to load Kubernetes secret '{namespace}/{secret_name}': {e}") from e

    data = secret.data or {}
    if cache is not None:
        cache[key] = data
    return data


def _extract_scalar(payload: dict[str, Any], path: str, *, source: str) -> str:
    """Extract a scalar value from *payload* via a glom dot-path."""
    require_dependency("glom", "aws-secrets", "for nested AWS secret field extraction")
    from glom import Coalesce, glom  # ty: ignore[unresolved-import]

    sentinel = object()
    value = glom(payload, Coalesce(path, default=sentinel))

    if value is sentinel:
        raise ValueError(f"{source} has no field '{path}'")

    if not isinstance(value, _SCALAR_TYPES):
        raise ValueError(
            f"{source} field '{path}' must be a scalar (got {type(value).__name__}); "
            "wrap nested objects in their own secret or pick a leaf field"
        )

    return str(value)


def _split_aws_identifier(identifier: str) -> tuple[str, str]:
    if "/" not in identifier:
        raise ValueError(f"AWS secret reference must be 'secret_name/field' (got '{identifier}')")
    secret_name, field = identifier.rsplit("/", 1)
    if not secret_name or not field:
        raise ValueError(f"AWS secret reference must be 'secret_name/field' (got '{identifier}')")
    return secret_name, field


def _aws_region_from_arn(secret_name: str) -> str | None:
    match = _AWS_ARN_REGION_REGEX.match(secret_name)
    return match.group("region") if match else None


def _split_k8s_identifier(identifier: str) -> tuple[str, str, str]:
    parts = identifier.split("/")
    if len(parts) == 2:
        secret_name, field = parts
        namespace = _pod_namespace()
    elif len(parts) == 3:
        namespace, secret_name, field = parts
    else:
        raise ValueError(
            f"Kubernetes secret reference must be 'secret/field' or 'namespace/secret/field' (got '{identifier}')"
        )
    if not secret_name or not field or not namespace:
        raise ValueError(
            f"Kubernetes secret reference must be 'secret/field' or 'namespace/secret/field' (got '{identifier}')"
        )
    return namespace, secret_name, field


def _pod_namespace() -> str:
    try:
        with open(_K8S_NAMESPACE_FILE) as f:
            return f.read().strip() or "default"
    except FileNotFoundError:
        return "default"


def _load_kube_config() -> None:
    from kubernetes import config as kube_config  # ty: ignore[unresolved-import]

    try:
        kube_config.load_incluster_config()
    except kube_config.config_exception.ConfigException:
        kube_config.load_kube_config()
