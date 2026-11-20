from __future__ import annotations

from contextlib import suppress
from io import StringIO
from pathlib import Path
from typing import TYPE_CHECKING, Any, Callable, cast

from pydantic import BaseModel, Field, model_validator

from nao_core.deps import require_dependency

if TYPE_CHECKING:
    from ibis import BaseBackend
    from paramiko import PKey
    from sshtunnel import SSHTunnelForwarder


class SSHTunnelConfig(BaseModel):
    ssh_host: str = Field(description="SSH bastion host")
    ssh_port: int = Field(default=22, ge=1, le=65535, description="SSH bastion port")
    ssh_username: str = Field(description="SSH username")
    ssh_private_key_path: str | None = Field(
        default=None,
        description="Path to an SSH private key",
    )
    ssh_private_key: str | None = Field(
        default=None,
        description="SSH private key contents",
        repr=False,
    )
    ssh_private_key_passphrase: str | None = Field(
        default=None,
        description="SSH private key passphrase",
        repr=False,
    )
    ssh_host_key: str | None = Field(
        default=None,
        description="Expected SSH bastion host key",
    )

    @model_validator(mode="after")
    def validate_private_key_source(self) -> SSHTunnelConfig:
        sources = [self.ssh_private_key_path, self.ssh_private_key]
        if sum(bool(source) for source in sources) != 1:
            raise ValueError("Exactly one of ssh_private_key_path or ssh_private_key is required")
        return self


def connect_through_ssh_tunnel(
    tunnel_config: SSHTunnelConfig | None,
    remote_host: str,
    remote_port: int,
    connect: Callable[[str, int], BaseBackend],
    dependency_extra: str,
) -> BaseBackend:
    if tunnel_config is None:
        return connect(remote_host, remote_port)
    tunnel = _create_ssh_tunnel(
        tunnel_config,
        remote_host,
        remote_port,
        dependency_extra,
    )
    try:
        tunnel.start()
        connection = connect("127.0.0.1", tunnel.local_bind_port)
    except BaseException:
        with suppress(Exception):
            tunnel.stop()
        raise
    return cast("BaseBackend", _TunneledBackend(connection, tunnel))


def _create_ssh_tunnel(
    config: SSHTunnelConfig,
    remote_host: str,
    remote_port: int,
    dependency_extra: str,
) -> SSHTunnelForwarder:
    require_dependency(
        "sshtunnel",
        dependency_extra,
        "for SSH tunnel connections",
    )
    from sshtunnel import SSHTunnelForwarder

    return SSHTunnelForwarder(
        (config.ssh_host, config.ssh_port),
        ssh_username=config.ssh_username,
        ssh_pkey=_load_private_key(config, dependency_extra),
        ssh_private_key_password=(config.ssh_private_key_passphrase if config.ssh_private_key_path else None),
        ssh_host_key=config.ssh_host_key,
        remote_bind_address=(remote_host, remote_port),
        local_bind_address=("127.0.0.1", 0),
    )


def _load_private_key(config: SSHTunnelConfig, dependency_extra: str) -> str | PKey:
    if config.ssh_private_key_path:
        return str(Path(config.ssh_private_key_path).expanduser())
    assert config.ssh_private_key is not None
    return _parse_private_key(
        config.ssh_private_key,
        config.ssh_private_key_passphrase,
        dependency_extra,
    )


def _parse_private_key(private_key: str, passphrase: str | None, dependency_extra: str) -> PKey:
    require_dependency(
        "paramiko",
        dependency_extra,
        "for SSH private key authentication",
    )
    from paramiko import ECDSAKey, Ed25519Key, RSAKey, SSHException
    from paramiko.ssh_exception import PasswordRequiredException

    last_error: Exception | None = None
    for key_type in (Ed25519Key, ECDSAKey, RSAKey):
        try:
            return key_type.from_private_key(
                StringIO(private_key),
                password=passphrase,
            )
        except PasswordRequiredException as error:
            if not passphrase:
                raise ValueError("The SSH private key requires a passphrase") from error
            last_error = error
        except (SSHException, ValueError) as error:
            last_error = error
    raise ValueError("The SSH private key is invalid or its passphrase is incorrect") from last_error


class _TunneledBackend:
    def __init__(
        self,
        connection: BaseBackend,
        tunnel: SSHTunnelForwarder,
    ):
        self._connection = connection
        self._tunnel = tunnel
        self._disconnected = False

    def disconnect(self) -> None:
        if self._disconnected:
            return
        self._disconnected = True
        try:
            self._connection.disconnect()
        finally:
            self._tunnel.stop()

    def __getattr__(self, name: str) -> Any:
        return getattr(self._connection, name)
