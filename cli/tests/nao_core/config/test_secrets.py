import base64
import os
import sys
from dataclasses import dataclass
from unittest.mock import MagicMock, patch

import pytest

from nao_core.config import secrets

# ---------------------------------------------------------------------------
# env resolver
# ---------------------------------------------------------------------------


def test_resolve_env_returns_value_from_environment():
    with patch.dict(os.environ, {"FOO": "bar"}):
        assert secrets.resolve_env("FOO") == "bar"


def test_resolve_env_returns_none_when_unset():
    with patch.dict(os.environ, {}, clear=True):
        assert secrets.resolve_env("MISSING") is None


def test_resolve_env_returns_none_for_empty_string():
    with patch.dict(os.environ, {"EMPTY": ""}):
        assert secrets.resolve_env("EMPTY") is None


def test_resolve_env_extra_env_takes_precedence():
    with patch.dict(os.environ, {"FOO": "from_env"}):
        assert secrets.resolve_env("FOO", extra_env={"FOO": "from_extra"}) == "from_extra"


# ---------------------------------------------------------------------------
# process_secrets dispatch
# ---------------------------------------------------------------------------


def test_process_secrets_replaces_env_token():
    with patch.dict(os.environ, {"DB_HOST": "localhost"}):
        rendered, missing = secrets.process_secrets("host: {{ env('DB_HOST') }}")
    assert rendered == "host: localhost"
    assert missing == {}


def test_process_secrets_tracks_missing_env():
    with patch.dict(os.environ, {}, clear=True):
        rendered, missing = secrets.process_secrets("host: {{ env('MISSING') }}")
    assert rendered == "host: "
    assert missing == {"MISSING": None}


def test_process_secrets_dispatches_to_aws_resolver():
    with patch.object(secrets, "resolve_aws", return_value="s3cr3t") as mock_aws:
        rendered, missing = secrets.process_secrets("password: {{ aws('db/password') }}")
    mock_aws.assert_called_once()
    args, kwargs = mock_aws.call_args
    assert args[0] == "db/password"
    assert "cache" in kwargs
    assert rendered == "password: s3cr3t"
    assert missing == {}


def test_process_secrets_dispatches_to_k8s_resolver():
    with patch.object(secrets, "resolve_k8s", return_value="kv") as mock_k8s:
        rendered, missing = secrets.process_secrets("token: {{ k8s('ns/sec/field') }}")
    mock_k8s.assert_called_once()
    assert mock_k8s.call_args.args[0] == "ns/sec/field"
    assert rendered == "token: kv"
    assert missing == {}


def test_process_secrets_supports_dollar_prefix_for_all_protocols():
    with (
        patch.object(secrets, "resolve_aws", return_value="v"),
        patch.dict(os.environ, {"X": "y"}),
    ):
        rendered, _ = secrets.process_secrets("a: ${{ aws('x/y') }}, b: ${{ env('X') }}")
    assert rendered == "a: v, b: y"


def test_process_secrets_mixed_protocols_in_one_document():
    with (
        patch.dict(os.environ, {"DB_HOST": "localhost"}),
        patch.object(secrets, "resolve_aws", return_value="awspw"),
        patch.object(secrets, "resolve_k8s", return_value="k8stok"),
    ):
        rendered, missing = secrets.process_secrets(
            "host: {{ env('DB_HOST') }}\npassword: {{ aws('db/password') }}\ntoken: {{ k8s('default/api/token') }}\n"
        )
    assert rendered == "host: localhost\npassword: awspw\ntoken: k8stok\n"
    assert missing == {}


def test_process_secrets_handles_mixed_missing_and_present_env_vars():
    with patch.dict(os.environ, {"PRESENT": "yes"}, clear=True):
        rendered, missing = secrets.process_secrets("a: {{ env('PRESENT') }}, b: {{ env('ABSENT') }}")
    assert rendered == "a: yes, b: "
    assert missing == {"ABSENT": None}


# ---------------------------------------------------------------------------
# AWS identifier parsing
# ---------------------------------------------------------------------------


def test_split_aws_identifier_simple_form():
    assert secrets._split_aws_identifier("name/field") == ("name", "field")


def test_split_aws_identifier_arn_form():
    arn = "arn:aws:secretsmanager:us-east-1:123456789012:secret:my-secret-AbCdEf"
    assert secrets._split_aws_identifier(f"{arn}/password") == (arn, "password")


def test_split_aws_identifier_preserves_dot_path_after_slash():
    # The slash separates secret_name from glom path; dots inside the path stay intact.
    assert secrets._split_aws_identifier("name/cred.user") == ("name", "cred.user")


def test_split_aws_identifier_rejects_missing_slash():
    with pytest.raises(ValueError, match="secret_name/field"):
        secrets._split_aws_identifier("no_slash")


def test_split_aws_identifier_rejects_empty_parts():
    with pytest.raises(ValueError, match="secret_name/field"):
        secrets._split_aws_identifier("name/")


def test_aws_region_from_arn():
    arn = "arn:aws:secretsmanager:eu-west-2:123456789012:secret:foo"
    assert secrets._aws_region_from_arn(arn) == "eu-west-2"


def test_aws_region_from_plain_name_is_none():
    assert secrets._aws_region_from_arn("plain_secret") is None


# ---------------------------------------------------------------------------
# Kubernetes identifier parsing
# ---------------------------------------------------------------------------


def test_split_k8s_identifier_with_namespace():
    assert secrets._split_k8s_identifier("kube-system/foo/bar") == ("kube-system", "foo", "bar")


def test_split_k8s_identifier_defaults_to_pod_namespace(monkeypatch):
    monkeypatch.setattr(secrets, "_pod_namespace", lambda: "my-ns")
    assert secrets._split_k8s_identifier("foo/bar") == ("my-ns", "foo", "bar")


def test_split_k8s_identifier_rejects_bad_format():
    with pytest.raises(ValueError, match="namespace/secret/field"):
        secrets._split_k8s_identifier("only_one")


def test_split_k8s_identifier_rejects_too_many_parts():
    with pytest.raises(ValueError, match="namespace/secret/field"):
        secrets._split_k8s_identifier("a/b/c/d")


def test_pod_namespace_falls_back_to_default(monkeypatch):
    monkeypatch.setattr(secrets, "_K8S_NAMESPACE_FILE", "/nonexistent/path")
    assert secrets._pod_namespace() == "default"


# ---------------------------------------------------------------------------
# AWS resolver (with mocked boto3)
# ---------------------------------------------------------------------------


@dataclass
class _AwsMocks:
    boto3: MagicMock
    session: MagicMock
    client: MagicMock
    botocore_exceptions: MagicMock


def _install_fake_boto3(monkeypatch, secret_string: str | None) -> _AwsMocks:
    fake_client = MagicMock()
    fake_client.get_secret_value.return_value = {"SecretString": secret_string}

    fake_session = MagicMock()
    fake_session.client.return_value = fake_client

    fake_boto3 = MagicMock()
    fake_boto3.session.Session.return_value = fake_session

    fake_botocore_exceptions = MagicMock()
    fake_botocore_exceptions.ClientError = Exception
    fake_botocore_exceptions.BotoCoreError = Exception

    monkeypatch.setitem(sys.modules, "boto3", fake_boto3)
    monkeypatch.setitem(sys.modules, "botocore", MagicMock())
    monkeypatch.setitem(sys.modules, "botocore.exceptions", fake_botocore_exceptions)
    monkeypatch.setattr(secrets, "require_dependency", lambda *a, **kw: None)
    return _AwsMocks(
        boto3=fake_boto3,
        session=fake_session,
        client=fake_client,
        botocore_exceptions=fake_botocore_exceptions,
    )


def test_resolve_aws_returns_field_from_json_payload(monkeypatch):
    _install_fake_boto3(monkeypatch, '{"username": "u", "password": "p"}')
    assert secrets.resolve_aws("my_secret/password") == "p"


def test_resolve_aws_extracts_nested_field_via_glom(monkeypatch):
    _install_fake_boto3(monkeypatch, '{"port": 5432, "cred": {"user": "potato"}}')
    assert secrets.resolve_aws("my_secret/cred.user") == "potato"


def test_resolve_aws_returns_scalar_int_as_string(monkeypatch):
    _install_fake_boto3(monkeypatch, '{"port": 5432}')
    assert secrets.resolve_aws("my_secret/port") == "5432"


def test_resolve_aws_rejects_nested_object_as_value(monkeypatch):
    _install_fake_boto3(monkeypatch, '{"cred": {"user": "x"}}')
    with pytest.raises(ValueError, match="must be a scalar"):
        secrets.resolve_aws("my_secret/cred")


def test_resolve_aws_raises_when_payload_is_not_json(monkeypatch):
    _install_fake_boto3(monkeypatch, "not-json")
    with pytest.raises(ValueError, match="not valid JSON"):
        secrets.resolve_aws("my_secret/password")


def test_resolve_aws_raises_when_payload_is_not_an_object(monkeypatch):
    _install_fake_boto3(monkeypatch, '"a string"')
    with pytest.raises(ValueError, match="not a JSON object"):
        secrets.resolve_aws("my_secret/password")


def test_resolve_aws_raises_when_field_is_missing(monkeypatch):
    _install_fake_boto3(monkeypatch, '{"username": "u"}')
    with pytest.raises(ValueError, match="has no field 'password'"):
        secrets.resolve_aws("my_secret/password")


def test_resolve_aws_raises_when_secret_string_is_empty(monkeypatch):
    _install_fake_boto3(monkeypatch, None)
    with pytest.raises(ValueError, match="no SecretString payload"):
        secrets.resolve_aws("my_secret/password")


def test_resolve_aws_wraps_botocore_errors_as_value_error(monkeypatch):
    """Non-ClientError boto3 exceptions (e.g. NoCredentialsError) must also surface as ValueError."""

    class _FakeNoCredentialsError(Exception):
        pass

    mocks = _install_fake_boto3(monkeypatch, '{"x": "y"}')
    # BotoCoreError is the base class for client-side failures like NoCredentialsError / EndpointConnectionError.
    mocks.botocore_exceptions.BotoCoreError = _FakeNoCredentialsError
    mocks.client.get_secret_value.side_effect = _FakeNoCredentialsError("Unable to locate credentials")

    with pytest.raises(ValueError, match="Failed to load AWS secret 'my_secret'"):
        secrets.resolve_aws("my_secret/x")


def test_resolve_aws_uses_region_from_arn(monkeypatch):
    mocks = _install_fake_boto3(monkeypatch, '{"x": "y"}')
    arn = "arn:aws:secretsmanager:eu-west-3:111122223333:secret:foo-AbCdEf"

    secrets.resolve_aws(f"{arn}/x")

    mocks.boto3.session.Session.assert_called_once_with(region_name="eu-west-3")
    mocks.client.get_secret_value.assert_called_once_with(SecretId=arn)


def test_resolve_aws_caches_repeated_requests_to_same_secret(monkeypatch):
    mocks = _install_fake_boto3(monkeypatch, '{"user": "u", "password": "p"}')
    cache: secrets.SecretCache = {}

    assert secrets.resolve_aws("my_secret/user", cache=cache) == "u"
    assert secrets.resolve_aws("my_secret/password", cache=cache) == "p"

    mocks.client.get_secret_value.assert_called_once_with(SecretId="my_secret")


def test_process_secrets_caches_aws_calls_within_one_document(monkeypatch):
    mocks = _install_fake_boto3(monkeypatch, '{"user": "u", "password": "p", "port": 5432}')

    rendered, _ = secrets.process_secrets(
        "user: {{ aws('db/user') }}\npassword: {{ aws('db/password') }}\nport: {{ aws('db/port') }}\n"
    )

    assert rendered == "user: u\npassword: p\nport: 5432\n"
    assert mocks.client.get_secret_value.call_count == 1


# ---------------------------------------------------------------------------
# Kubernetes resolver (with mocked kubernetes client)
# ---------------------------------------------------------------------------


@dataclass
class _K8sMocks:
    kubernetes: MagicMock
    v1: MagicMock


def _install_fake_kubernetes(monkeypatch, data: dict[str, str] | None) -> _K8sMocks:
    secret_obj = MagicMock()
    secret_obj.data = data

    fake_v1 = MagicMock()
    fake_v1.read_namespaced_secret.return_value = secret_obj

    fake_client_module = MagicMock()
    fake_client_module.CoreV1Api.return_value = fake_v1

    fake_config_module = MagicMock()

    fake_kubernetes = MagicMock()
    fake_kubernetes.client = fake_client_module
    fake_kubernetes.config = fake_config_module

    monkeypatch.setitem(sys.modules, "kubernetes", fake_kubernetes)
    monkeypatch.setitem(sys.modules, "kubernetes.client", fake_client_module)
    monkeypatch.setitem(sys.modules, "kubernetes.config", fake_config_module)
    monkeypatch.setattr(secrets, "require_dependency", lambda *a, **kw: None)
    monkeypatch.setattr(secrets, "_load_kube_config", lambda: None)
    return _K8sMocks(kubernetes=fake_kubernetes, v1=fake_v1)


def test_resolve_k8s_returns_base64_decoded_field(monkeypatch):
    encoded = base64.b64encode(b"super-secret").decode()
    _install_fake_kubernetes(monkeypatch, {"password": encoded})

    assert secrets.resolve_k8s("default/db/password") == "super-secret"


def test_resolve_k8s_raises_when_field_missing(monkeypatch):
    _install_fake_kubernetes(monkeypatch, {"other": "Zm9v"})

    with pytest.raises(ValueError, match="has no field 'password'"):
        secrets.resolve_k8s("default/db/password")


def test_resolve_k8s_uses_pod_namespace_when_omitted(monkeypatch):
    encoded = base64.b64encode(b"v").decode()
    mocks = _install_fake_kubernetes(monkeypatch, {"f": encoded})
    monkeypatch.setattr(secrets, "_pod_namespace", lambda: "my-ns")

    secrets.resolve_k8s("db/f")
    mocks.v1.read_namespaced_secret.assert_called_once_with(name="db", namespace="my-ns")


def test_resolve_k8s_caches_repeated_requests_to_same_secret(monkeypatch):
    encoded_user = base64.b64encode(b"u").decode()
    encoded_pw = base64.b64encode(b"p").decode()
    mocks = _install_fake_kubernetes(monkeypatch, {"user": encoded_user, "password": encoded_pw})
    cache: secrets.SecretCache = {}

    assert secrets.resolve_k8s("default/db/user", cache=cache) == "u"
    assert secrets.resolve_k8s("default/db/password", cache=cache) == "p"

    mocks.v1.read_namespaced_secret.assert_called_once_with(name="db", namespace="default")
