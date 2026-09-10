import importlib
import json
from unittest.mock import Mock

metabase_commands = importlib.import_module("nao_core.commands.metabase")


def test_execute_card_sends_parameters_and_prints_json(monkeypatch, capsys):
    client = Mock()
    client.request.return_value = {"result": {"cardId": 7, "rows": [[1]]}}
    monkeypatch.setattr(metabase_commands, "DashboardMigrationClient", lambda: client)

    metabase_commands.execute_card(7, parameters='{"region":"EU"}', server_name="source", json_output=True)

    client.request.assert_called_once_with(
        "POST",
        "/cards/7/execute",
        body={"server_name": "source", "parameters": {"region": "EU"}},
    )
    assert json.loads(capsys.readouterr().out) == {"result": {"cardId": 7, "rows": [[1]]}}
