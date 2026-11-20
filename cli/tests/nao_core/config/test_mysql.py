from types import ModuleType, SimpleNamespace
from unittest.mock import MagicMock, patch

from nao_core.config.databases import mysql
from nao_core.config.databases.mysql import MysqlConfig
from nao_core.config.databases.ssh_tunnel import SSHTunnelConfig


def test_connect_uses_tunnel_host_and_port():
    backend = MagicMock()
    mysql_connect = MagicMock(return_value=backend)
    ibis_module = ModuleType("ibis")
    setattr(ibis_module, "mysql", SimpleNamespace(connect=mysql_connect))
    ssh_tunnel = SSHTunnelConfig(
        ssh_host="bastion.example.com",
        ssh_username="nao",
        ssh_private_key_path="/keys/id_ed25519",
    )
    config = MysqlConfig(
        name="mysql",
        host="mysql.internal",
        database="analytics",
        user="nao",
        password="secret",
        ssh_tunnel=ssh_tunnel,
    )

    def connect_through_tunnel(tunnel_config, remote_host, remote_port, connect, dependency_extra):
        assert tunnel_config is ssh_tunnel
        assert (remote_host, remote_port) == ("mysql.internal", 3306)
        assert dependency_extra == "mysql"
        return connect("127.0.0.1", 43127)

    with (
        patch("nao_core.deps.require_database_backend") as require_database_backend,
        patch.object(mysql, "connect_through_ssh_tunnel", side_effect=connect_through_tunnel),
        patch.dict("sys.modules", {"ibis": ibis_module}),
    ):
        result = config.connect()

    require_database_backend.assert_called_once_with("mysql")
    mysql_connect.assert_called_once_with(
        host="127.0.0.1",
        port=43127,
        database="analytics",
        user="nao",
        password="secret",
    )
    assert result is backend
