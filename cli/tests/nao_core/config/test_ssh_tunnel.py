from io import StringIO
from types import ModuleType
from unittest.mock import MagicMock, patch

import pytest
from paramiko import RSAKey
from pydantic import ValidationError

from nao_core.config.databases import ssh_tunnel
from nao_core.config.databases.ssh_tunnel import SSHTunnelConfig, connect_through_ssh_tunnel


@pytest.mark.parametrize(
    ("private_key_path", "private_key", "is_valid"),
    [
        ("/keys/id_ed25519", None, True),
        (None, "private-key-contents", True),
        (None, None, False),
        ("/keys/id_ed25519", "private-key-contents", False),
    ],
)
def test_requires_exactly_one_private_key_source(
    private_key_path: str | None,
    private_key: str | None,
    is_valid: bool,
):
    values = {
        "ssh_host": "bastion.example.com",
        "ssh_username": "nao",
        "ssh_private_key_path": private_key_path,
        "ssh_private_key": private_key,
    }

    if is_valid:
        config = SSHTunnelConfig.model_validate(values)
        assert config.ssh_private_key_path == private_key_path
        assert config.ssh_private_key == private_key
        return

    with pytest.raises(ValidationError, match="Exactly one of ssh_private_key_path or ssh_private_key is required"):
        SSHTunnelConfig.model_validate(values)


def test_hides_private_key_secrets_from_repr():
    config = _tunnel_config(
        ssh_private_key_path=None,
        ssh_private_key="private-key-contents",
        ssh_private_key_passphrase="key-passphrase",
    )

    representation = repr(config)

    assert "private-key-contents" not in representation
    assert "key-passphrase" not in representation


def test_connects_directly_without_tunnel():
    connection = MagicMock()
    connect = MagicMock(return_value=connection)

    result = connect_through_ssh_tunnel(None, "redshift.internal", 5439, connect, "redshift")

    assert result is connection
    connect.assert_called_once_with("redshift.internal", 5439)


def test_routes_connection_through_tunnel_and_stops_once():
    tunnel = MagicMock(local_bind_port=43127)
    connection = MagicMock()
    connection.raw_sql.return_value = "query-result"
    connect = MagicMock(return_value=connection)

    with patch.object(ssh_tunnel, "_create_ssh_tunnel", return_value=tunnel):
        result = connect_through_ssh_tunnel(
            _tunnel_config(),
            "redshift.internal",
            5439,
            connect,
            "redshift",
        )

    tunnel.start.assert_called_once_with()
    connect.assert_called_once_with("127.0.0.1", 43127)
    assert getattr(result, "raw_sql")("SELECT 1") == "query-result"
    connection.raw_sql.assert_called_once_with("SELECT 1")

    result.disconnect()
    result.disconnect()

    connection.disconnect.assert_called_once_with()
    tunnel.stop.assert_called_once_with()


def test_stops_tunnel_when_database_connection_fails():
    tunnel = MagicMock(local_bind_port=43127)
    connect = MagicMock(side_effect=RuntimeError("connection failed"))

    with (
        patch.object(ssh_tunnel, "_create_ssh_tunnel", return_value=tunnel),
        pytest.raises(RuntimeError, match="connection failed"),
    ):
        connect_through_ssh_tunnel(
            _tunnel_config(),
            "redshift.internal",
            5439,
            connect,
            "redshift",
        )

    tunnel.start.assert_called_once_with()
    tunnel.stop.assert_called_once_with()


def test_stops_tunnel_when_start_fails():
    tunnel = MagicMock()
    tunnel.start.side_effect = RuntimeError("tunnel failed")
    connect = MagicMock()

    with (
        patch.object(ssh_tunnel, "_create_ssh_tunnel", return_value=tunnel),
        pytest.raises(RuntimeError, match="tunnel failed"),
    ):
        connect_through_ssh_tunnel(
            _tunnel_config(),
            "redshift.internal",
            5439,
            connect,
            "redshift",
        )

    connect.assert_not_called()
    tunnel.stop.assert_called_once_with()


def test_creates_forwarder_with_bastion_and_warehouse_addresses():
    forwarder = MagicMock()
    forwarder_class = MagicMock(return_value=forwarder)
    sshtunnel_module = ModuleType("sshtunnel")
    setattr(sshtunnel_module, "SSHTunnelForwarder", forwarder_class)
    private_key = MagicMock()
    host_key = MagicMock()
    config = _tunnel_config(
        ssh_private_key_path=None,
        ssh_private_key="private-key-contents",
        ssh_host_key="bastion.example.com ssh-ed25519 host-key",
    )

    with (
        patch.object(ssh_tunnel, "require_dependency") as require_dependency,
        patch.object(ssh_tunnel, "_load_private_key", return_value=private_key),
        patch.object(ssh_tunnel, "_parse_ssh_host_key", return_value=host_key) as parse_host_key,
        patch.dict("sys.modules", {"sshtunnel": sshtunnel_module}),
    ):
        result = ssh_tunnel._create_ssh_tunnel(config, "redshift.internal", 5439, "redshift")

    assert result is forwarder
    require_dependency.assert_called_once_with("sshtunnel", "redshift", "for SSH tunnel connections")
    parse_host_key.assert_called_once_with("bastion.example.com ssh-ed25519 host-key", "redshift")
    forwarder_class.assert_called_once_with(
        ("bastion.example.com", 22),
        ssh_username="nao",
        ssh_pkey=private_key,
        ssh_private_key_password=None,
        ssh_host_key=host_key,
        remote_bind_address=("redshift.internal", 5439),
        local_bind_address=("127.0.0.1", 0),
    )


def test_rejects_tunnel_without_bastion_host_key():
    with (
        patch.object(ssh_tunnel, "require_dependency") as require_dependency,
        pytest.raises(ValueError, match="SSH bastion host key is required"),
    ):
        ssh_tunnel._create_ssh_tunnel(_tunnel_config(), "redshift.internal", 5439, "redshift")

    require_dependency.assert_not_called()


def test_parses_private_key_contents_from_memory():
    private_key = RSAKey.generate(1024)
    private_key_file = StringIO()
    private_key.write_private_key(private_key_file)

    parsed_key = ssh_tunnel._parse_private_key(private_key_file.getvalue(), None, "redshift")

    assert parsed_key.get_fingerprint() == private_key.get_fingerprint()


def test_requires_passphrase_for_encrypted_private_key():
    private_key = RSAKey.generate(1024)
    private_key_file = StringIO()
    private_key.write_private_key(private_key_file, password="key-passphrase")

    with pytest.raises(ValueError, match="requires a passphrase"):
        ssh_tunnel._parse_private_key(private_key_file.getvalue(), None, "redshift")


def test_parses_one_known_hosts_line():
    host_key = RSAKey.generate(1024)
    known_hosts_line = f"bastion.example.com {host_key.get_name()} {host_key.get_base64()}"

    parsed_key = ssh_tunnel._parse_ssh_host_key(known_hosts_line, "redshift")

    assert parsed_key.get_name() == host_key.get_name()
    assert parsed_key.get_fingerprint() == host_key.get_fingerprint()


@pytest.mark.parametrize(
    "host_key",
    [
        "",
        "# ssh-keyscan comment",
        "not-a-known-hosts-line",
        "\n".join(
            [
                "bastion.example.com ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIA",
                "bastion.example.com ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABAQ",
            ]
        ),
    ],
)
def test_rejects_invalid_or_multiple_host_key_lines(host_key: str):
    with pytest.raises(ValueError, match="SSH bastion host key|required"):
        ssh_tunnel._parse_ssh_host_key(host_key, "redshift")


def _tunnel_config(**overrides: object) -> SSHTunnelConfig:
    values: dict[str, object] = {
        "ssh_host": "bastion.example.com",
        "ssh_username": "nao",
        "ssh_private_key_path": "/keys/id_ed25519",
        **overrides,
    }
    return SSHTunnelConfig.model_validate(values)
