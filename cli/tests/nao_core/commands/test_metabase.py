import importlib
import json
from unittest.mock import Mock

import pytest

metabase_commands = importlib.import_module("nao_core.commands.metabase")


def test_execute_card_sends_parameters_and_prints_json(monkeypatch, capsys):
    client = Mock()
    client.request.return_value = {"result": {"cardId": 7, "rows": [[1]]}}
    client_factory = Mock(return_value=client)
    monkeypatch.setattr(metabase_commands, "MigrationClient", client_factory)

    metabase_commands.execute_card(
        7,
        parameters='[{"id":"region","type":"string/=","value":["EU"]}]',
        server_name="source",
        project_id="project-1",
        json_output=True,
    )

    client_factory.assert_called_once_with(project_id="project-1", noninteractive=True)
    client.request.assert_called_once_with(
        "POST",
        "/cards/7/execute",
        body={
            "server_name": "source",
            "parameters": [{"id": "region", "type": "string/=", "value": ["EU"]}],
        },
    )
    assert json.loads(capsys.readouterr().out) == {"result": {"cardId": 7, "rows": [[1]]}}


def test_execute_card_rejects_malformed_parameters(monkeypatch):
    client_factory = Mock()
    monkeypatch.setattr(metabase_commands, "MigrationClient", client_factory)

    with pytest.raises(metabase_commands.MigrationError, match="Invalid --parameters JSON"):
        metabase_commands.execute_card(7, parameters="{")

    client_factory.assert_not_called()


def test_compile_card_prints_native_bound_parameters(monkeypatch, capsys):
    client = Mock()
    client.request.return_value = {
        "query": {
            "sourceType": "native",
            "nativeSql": "SELECT * FROM orders WHERE status = ?",
            "boundParameters": ["completed"],
        }
    }
    monkeypatch.setattr(metabase_commands, "MigrationClient", Mock(return_value=client))

    metabase_commands.compile_card(7)

    output = capsys.readouterr().out
    assert "SELECT * FROM orders WHERE status = ?" in output
    assert 'Bound parameters: ["completed"]' in output
