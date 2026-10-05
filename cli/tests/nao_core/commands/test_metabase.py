import json
from pathlib import Path
from unittest.mock import MagicMock, Mock, call

import pytest
import yaml

from nao_core.commands.migrate import metabase as metabase_commands
from nao_core.commands.migrate import metabase_client


def _compiled_response(sql, parameters):
    return {"data": {"native_form": {"query": sql, "params": parameters}}}


@pytest.mark.parametrize("command", ["dashboard", "question", "collection"])
def test_export_commands_share_flattened_options(command):
    _, bound, _ = metabase_commands.metabase.parse_args(
        [
            command,
            "42",
            "--parameter",
            "period=1",
            "--allow-query-execution",
            "--json",
            "--output",
            "manifest",
        ]
    )

    assert bound.arguments["options"] == metabase_commands.ExportOptions(
        parameters=["period=1"],
        allow_query_execution=True,
        json_output=True,
        output=Path("manifest"),
    )


def test_configure_masks_api_key_input_and_saves_credentials_to_nao_config(monkeypatch, tmp_path):
    config_path = tmp_path / "nao_config.yaml"
    config_path.write_text("project_name: test-project\nthreads: 4\n")
    ask_text = Mock(side_effect=["https://metabase.example.com/", "secret-key"])
    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr(metabase_commands, "ask_text", ask_text)
    monkeypatch.setattr(metabase_commands.UI, "success", Mock())

    metabase_commands.configure()

    assert ask_text.call_args_list == [
        call("Metabase URL:", default="", required_field=True),
        call("Metabase API key:", password=True, required_field=True),
    ]
    assert yaml.safe_load(config_path.read_text()) == {
        "project_name": "test-project",
        "threads": 4,
        "metabase": {
            "url": "https://metabase.example.com",
            "api_key": "secret-key",
        },
    }


def test_metabase_config_masks_api_key_from_repr_and_dumps():
    config = metabase_commands.MetabaseConfig.model_validate(
        {"url": "https://metabase.example.com", "api_key": "secret-key"}
    )

    assert "secret-key" not in repr(config)
    assert config.model_dump(mode="json")["api_key"] == "**********"
    assert config.api_key.get_secret_value() == "secret-key"


def test_configure_requires_nao_config_in_current_directory(monkeypatch, tmp_path):
    (tmp_path / "nao_config.yaml").write_text("project_name: test-project\n")
    nested_path = tmp_path / "nested"
    nested_path.mkdir()
    ask_text = Mock()
    error = Mock()
    monkeypatch.chdir(nested_path)
    monkeypatch.setattr(metabase_commands, "ask_text", ask_text)
    monkeypatch.setattr(metabase_commands.UI, "error", error)

    with pytest.raises(SystemExit):
        metabase_commands.configure()

    ask_text.assert_not_called()
    error.assert_called_once_with("No nao_config.yaml found in current directory")


def test_metabase_credentials_are_loaded_from_nao_config(monkeypatch, tmp_path):
    (tmp_path / "nao_config.yaml").write_text(
        "project_name: test-project\nmetabase:\n  url: https://metabase.example.com\n  api_key: test-key\n"
    )
    monkeypatch.chdir(tmp_path)

    assert metabase_commands._configured_metabase_url() == "https://metabase.example.com"
    assert metabase_commands._configured_metabase_api_key("question") == "test-key"


@pytest.mark.parametrize(
    ("url", "normalized_url"),
    [
        ("https://METABASE.example.com:443/metabase/", "https://METABASE.example.com:443/metabase"),
        ("http://localhost:3000/", "http://localhost:3000"),
        ("http://127.0.0.1:3000/", "http://127.0.0.1:3000"),
        ("http://[::1]:3000/", "http://[::1]:3000"),
        ("http://metabase.internal/metabase", "http://metabase.internal/metabase"),
        ("https://user:password@metabase.example.com", "https://user:password@metabase.example.com"),
        ("https://metabase.example.com?foo=bar", "https://metabase.example.com"),
        ("https://metabase.example.com#fragment", "https://metabase.example.com"),
    ],
)
def test_metabase_url_normalization_accepts_http_and_reverse_proxy_urls(url, normalized_url):
    assert metabase_commands._normalize_metabase_url(url) == normalized_url


def test_metabase_sources_accept_ids_or_urls(monkeypatch):
    monkeypatch.setattr(
        metabase_commands,
        "_configured_metabase_url",
        lambda _resource="resource": "https://configured.example.com/metabase",
    )

    assert metabase_commands._resolve_dashboard_source("42") == (
        "https://configured.example.com/metabase",
        42,
    )
    assert metabase_commands._resolve_dashboard_source(
        "https://configured.example.com:443/metabase/dashboard/7-sales"
    ) == (
        "https://configured.example.com/metabase",
        7,
    )

    with pytest.raises(metabase_commands.MetabaseCliError):
        metabase_commands._resolve_dashboard_source("dashboard-42")

    assert metabase_commands._resolve_question_source("https://configured.example.com/metabase/question/8-orders") == (
        "https://configured.example.com/metabase",
        8,
    )
    assert metabase_commands._resolve_collection_source(
        "https://configured.example.com/metabase/collection/3-finance"
    ) == (
        "https://configured.example.com/metabase",
        3,
    )


def test_metabase_source_url_warns_on_unconfigured_origin(monkeypatch):
    warn = Mock()
    monkeypatch.setattr(
        metabase_commands,
        "_configured_metabase_url",
        lambda _resource="resource": "https://configured.example.com/metabase",
    )
    monkeypatch.setattr(metabase_commands.UI, "warn", warn)

    assert metabase_commands._resolve_dashboard_source("https://other.example.com/dashboard/7") == (
        "https://configured.example.com/metabase",
        7,
    )
    assert metabase_commands._resolve_dashboard_source("https://configured.example.com/other/dashboard/8") == (
        "https://configured.example.com/metabase",
        8,
    )
    warn.assert_called_once_with(
        "Dashboard URL uses a different server; reading it from the Metabase configured in nao_config.yaml."
    )


@pytest.mark.parametrize(
    "url",
    [
        "https://user:password@configured.example.com/metabase/dashboard/7",
        "https://configured.example.com/metabase/dashboard/7?token=secret",
        "https://configured.example.com/metabase/dashboard/7#fragment",
    ],
)
def test_metabase_source_url_ignores_non_path_components(monkeypatch, url):
    monkeypatch.setattr(
        metabase_commands,
        "_configured_metabase_url",
        lambda _resource="resource": "https://configured.example.com/metabase",
    )

    assert metabase_commands._resolve_dashboard_source(url) == ("https://configured.example.com/metabase", 7)


@pytest.mark.parametrize(
    "dashboard",
    [
        {"id": 42},
        {"id": 42, "dashcards": {}, "tabs": []},
        {"id": 42, "dashcards": [], "tabs": {}},
        {"id": 42, "dashcards": [{"card_id": 9, "card": {"id": 9}}]},
    ],
)
def test_fetch_dashboard_rejects_malformed_responses(dashboard):
    client = Mock()
    client.fetch_dashboard.return_value = dashboard

    with pytest.raises(metabase_commands.MetabaseCliError, match="unexpected"):
        metabase_commands._fetch_dashboard(client, 42)


@pytest.mark.parametrize(
    "question",
    [
        {"id": 12, "dataset_query": {}},
        {"id": 11},
        {"id": 11, "dataset_query": {}, "visualization_settings": []},
        {"id": 11, "dataset_query": {}, "result_metadata": {}},
    ],
)
def test_fetch_question_rejects_malformed_responses(question):
    client = Mock()
    client.fetch_question.return_value = question

    with pytest.raises(metabase_commands.MetabaseCliError, match="unexpected question response"):
        metabase_commands._fetch_question(client, 11)


def test_manifest_preserves_layout_visualization_and_query():
    dataset_query = {
        "type": "native",
        "database": 2,
        "native": {"query": "SELECT month, revenue FROM sales"},
    }
    manifest = metabase_commands._build_dashboard_manifest(
        "https://metabase.example.com",
        {
            "id": 42,
            "name": "Revenue",
            "description": "Monthly revenue",
            "collection_id": 3,
            "tabs": [{"id": 2, "name": "Details", "position": 1}],
            "parameters": [{"id": "period", "type": "date/range"}],
            "dashcards": [
                {
                    "id": 7,
                    "card_id": 9,
                    "dashboard_tab_id": 2,
                    "row": 1,
                    "col": 2,
                    "size_x": 12,
                    "size_y": 6,
                    "parameter_mappings": [{"parameter_id": "period", "card_id": 9}],
                    "visualization_settings": {"graph.show_values": True},
                    "card": {
                        "id": 9,
                        "name": "Monthly revenue",
                        "display": "line",
                        "database_id": 2,
                        "dataset_query": dataset_query,
                        "visualization_settings": {"graph.dimensions": ["month"]},
                        "result_metadata": [{"name": "month"}, {"name": "revenue"}],
                    },
                    "series": [
                        {
                            "id": 10,
                            "name": "Forecast",
                            "display": "line",
                            "database_id": 2,
                            "dataset_query": {
                                "type": "native",
                                "database": 2,
                                "native": {"query": "SELECT month, forecast FROM forecast"},
                            },
                        }
                    ],
                },
                {
                    "id": 8,
                    "card_id": 11,
                    "row": 7,
                    "col": 0,
                    "size_x": 12,
                    "size_y": 6,
                    "card": {
                        "id": 11,
                        "name": "Orders",
                        "display": "bar",
                        "database_id": 2,
                        "dataset_query": {
                            "type": "query",
                            "database": 2,
                            "query": {"source-table": 3},
                        },
                    },
                },
            ],
        },
        {(8, 11): {"sql": "SELECT category, count(*) FROM orders GROUP BY category", "parameters": []}},
        databases=[{"id": 2, "name": "Analytics", "engine": "postgres"}],
    )

    card = manifest["dashboard"]["cards"][0]
    mbql_question = manifest["dashboard"]["cards"][1]["question"]
    assert manifest["databases"] == [{"id": 2, "name": "Analytics", "engine": "postgres"}]
    assert card["layout"] == {"row": 1, "column": 2, "width": 12, "height": 6}
    assert card["visualization_settings"] == {"graph.show_values": True}
    assert card["effective_filter_ids"] == ["period"]
    assert card["question"]["dataset_query"] == dataset_query
    assert card["question"]["native_sql"] == "SELECT month, revenue FROM sales"
    assert card["question"]["sql"] == "SELECT month, revenue FROM sales"
    assert card["series"][0]["question"]["native_sql"] == "SELECT month, forecast FROM forecast"
    assert mbql_question["mbql"]["query"] == {"source-table": 3}
    assert mbql_question["sql"] == "SELECT category, count(*) FROM orders GROUP BY category"


def test_dashboard_preserves_inaccessible_card_as_limitation():
    dashboard = {
        "id": 42,
        "parameters": [{"id": "period", "type": "date/single"}],
        "dashcards": [
            {
                "id": 7,
                "card_id": 9,
                "card": None,
                "parameter_mappings": [
                    {
                        "parameter_id": "period",
                        "card_id": 9,
                        "target": ["dimension", ["field", 1, None]],
                    }
                ],
            },
            {
                "id": 8,
                "card_id": 10,
                "card": {
                    "id": 10,
                    "name": "Orders",
                    "dataset_query": {"type": "native", "native": {"query": "SELECT * FROM orders"}},
                },
            },
        ],
    }
    client = Mock()
    client.fetch_dashboard.return_value = dashboard

    manifest = metabase_commands._export_dashboard(
        client,
        "https://metabase.example.com",
        42,
        {"period": "2026-09-01"},
    )

    assert [card["question_id"] for card in manifest["dashboard"]["cards"]] == [9, 10]
    assert manifest["dashboard"]["cards"][0]["question"] is None
    assert manifest["dashboard"]["cards"][1]["question"]["name"] == "Orders"
    client.compile_question.assert_not_called()
    assert manifest["limitations"] == [
        {
            "kind": "question",
            "dashcard_id": 7,
            "question_id": 9,
            "question_name": None,
            "reason": metabase_commands.INACCESSIBLE_CARD_LIMITATION,
        }
    ]


def test_compiled_query_extracts_sql_and_parameters():
    assert metabase_commands._extract_compiled_query(
        {
            "data": {
                "native_form": {
                    "query": "SELECT * FROM orders WHERE status = ?",
                    "params": ["completed"],
                }
            }
        }
    ) == {
        "sql": "SELECT * FROM orders WHERE status = ?",
        "parameters": ["completed"],
    }


@pytest.mark.parametrize(
    ("dashboard_id", "body"),
    [
        (42, {"dashboard_id": 42, "parameters": []}),
        (None, {"parameters": []}),
    ],
)
def test_compile_question_requests_sql_from_metabase(monkeypatch, dashboard_id, body):
    response = Mock()
    response.json.return_value = {
        "data": {
            "native_form": {
                "query": "SELECT category, count(*) FROM orders GROUP BY category",
                "params": [],
            }
        }
    }
    http_client = MagicMock()
    http_client.request.return_value = response
    monkeypatch.setattr(metabase_client.httpx, "Client", Mock(return_value=http_client))

    with metabase_client.MetabaseClient("https://metabase.example.com", "test-key") as client:
        compiled = metabase_commands._compile_question(client, dashboard_id, 11)

    assert compiled["sql"] == "SELECT category, count(*) FROM orders GROUP BY category"
    http_client.request.assert_called_once_with(
        "POST",
        "https://metabase.example.com/api/card/11/query",
        json=body,
    )
    http_client.close.assert_called_once_with()


def test_failed_query_compilation_identifies_the_dashcard():
    client = Mock()
    client.compile_question.side_effect = metabase_commands.MetabaseCliError("Compilation failed")
    question = {
        "id": 11,
        "name": "Orders",
        "dataset_query": {"type": "query", "query": {"source-table": 3}},
    }

    compiled, limitations = metabase_commands._compile_queries(
        client,
        42,
        {"dashcards": [{"id": 7, "card": question}]},
        allow_query_execution=True,
    )

    assert compiled == {}
    assert limitations == [
        {
            "kind": "question",
            "dashcard_id": 7,
            "question_id": 11,
            "question_name": "Orders",
            "reason": "Compilation failed",
        }
    ]
    client.compile_question.assert_called_once_with(11, 42, [])


def test_dashboard_compilation_requires_explicit_query_execution():
    client = Mock()
    question = {
        "id": 11,
        "name": "Orders",
        "dataset_query": {"type": "query", "query": {"source-table": 3}},
    }

    compiled, limitations = metabase_commands._compile_queries(
        client,
        42,
        {"dashcards": [{"id": 7, "card": question}]},
    )

    assert compiled == {}
    assert limitations == [
        {
            "kind": "question",
            "dashcard_id": 7,
            "question_id": 11,
            "question_name": "Orders",
            "reason": metabase_commands.QUERY_EXECUTION_REQUIRED_LIMITATION,
        }
    ]
    client.compile_question.assert_not_called()


def test_dashboard_compilation_preserves_each_dashcard_parameter_context():
    client = Mock()
    client.compile_question.side_effect = [
        _compiled_response("SELECT * FROM orders WHERE period = ?", ["2026-09-01"]),
        _compiled_response("SELECT * FROM orders WHERE region = ?", ["France"]),
    ]
    question = {
        "id": 11,
        "name": "Orders",
        "dataset_query": {"type": "query", "query": {"source-table": 3}},
    }
    dashboard = {
        "parameters": [
            {"id": "period", "type": "date/single", "default": "2026-01-01"},
            {"id": "region", "type": "category", "default": ["France"]},
        ],
        "dashcards": [
            {
                "id": 7,
                "card_id": 11,
                "card": question,
                "parameter_mappings": [
                    {"parameter_id": "period", "card_id": 11, "target": ["dimension", ["field", 1, None]]},
                ],
            },
            {
                "id": 8,
                "card_id": 11,
                "card": question,
                "parameter_mappings": [
                    {"parameter_id": "region", "card_id": 11, "target": ["dimension", ["field", 2, None]]},
                ],
            },
        ],
    }

    compiled, limitations = metabase_commands._compile_queries(
        client,
        42,
        dashboard,
        {"period": "2026-09-01"},
        allow_query_execution=True,
    )

    assert limitations == [
        {
            "kind": "question",
            "dashcard_id": 7,
            "question_id": 11,
            "question_name": "Orders",
            "reason": metabase_commands.BOUND_SQL_PARAMETERS_LIMITATION,
        },
        {
            "kind": "question",
            "dashcard_id": 8,
            "question_id": 11,
            "question_name": "Orders",
            "reason": metabase_commands.BOUND_SQL_PARAMETERS_LIMITATION,
        },
    ]
    assert client.compile_question.call_args_list == [
        call(
            11,
            42,
            [
                {
                    "id": "period",
                    "type": "date/single",
                    "target": ["dimension", ["field", 1, None]],
                    "value": "2026-09-01",
                }
            ],
        ),
        call(
            11,
            42,
            [
                {
                    "id": "region",
                    "type": "category",
                    "target": ["dimension", ["field", 2, None]],
                    "value": ["France"],
                }
            ],
        ),
    ]
    manifest = metabase_commands._build_dashboard_manifest(
        "https://metabase.example.com",
        dashboard,
        compiled,
    )
    assert manifest["dashboard"]["cards"][0]["question"]["sql"] is None
    assert manifest["dashboard"]["cards"][1]["question"]["sql"] is None
    assert manifest["dashboard"]["cards"][0]["question"]["sql_parameters"] == ["2026-09-01"]
    assert manifest["dashboard"]["cards"][1]["question"]["sql_parameters"] == ["France"]

    with pytest.raises(metabase_commands.MetabaseCliError, match="Unknown or unused.*typo"):
        metabase_commands._compile_queries(
            client,
            42,
            dashboard,
            {"typo": "2026-09-01"},
        )


def test_parameter_values_require_unique_ids_and_json():
    assert metabase_commands._parse_parameter_values(['period="2026-09-01"', 'regions=["France","Germany"]']) == {
        "period": "2026-09-01",
        "regions": ["France", "Germany"],
    }

    with pytest.raises(metabase_commands.MetabaseCliError):
        metabase_commands._parse_parameter_values(["period=September"])
    with pytest.raises(metabase_commands.MetabaseCliError):
        metabase_commands._parse_parameter_values(["period=1", "period=2"])


def test_dashboard_prints_compact_json(monkeypatch, capsys):
    manifest = {"version": 1, "dashboard": {"id": 42}}
    monkeypatch.setattr(
        metabase_commands,
        "export_dashboard",
        lambda _source, _parameters, _consumed_parameter_ids, _allow_query_execution: manifest,
    )

    metabase_commands.dashboard(["42"], options=metabase_commands.ExportOptions(json_output=True))

    output = capsys.readouterr().out
    batch = {
        "version": 1,
        "type": "metabase-batch",
        "resource": "dashboard",
        "selection": {"mode": "explicit", "sources": ["42"]},
        "items": [manifest],
        "errors": [],
    }
    assert json.loads(output) == batch
    assert output == json.dumps(batch, ensure_ascii=False, separators=(",", ":")) + "\n"


def test_dashboard_returns_json_for_command_errors(monkeypatch, capsys):
    with pytest.raises(SystemExit):
        metabase_commands.dashboard(
            ["42"],
            options=metabase_commands.ExportOptions(parameters=["invalid"], json_output=True),
        )

    manifest = json.loads(capsys.readouterr().out)
    assert manifest["resource"] == "dashboard"
    assert manifest["items"] == []
    assert manifest["errors"] == [{"source": "42", "reason": "Parameters must use ID=JSON format."}]


def test_dashboard_writes_manifest_to_output(monkeypatch, tmp_path):
    manifest = {"version": 1, "dashboard": {"id": 42}}
    destination = tmp_path / "exports" / "dashboard.json"
    monkeypatch.setattr(
        metabase_commands,
        "export_dashboard",
        lambda _source, _parameters, _consumed_parameter_ids, _allow_query_execution: manifest,
    )
    monkeypatch.setattr(metabase_commands.UI, "success", lambda _message: None)

    metabase_commands.dashboard(["42"], options=metabase_commands.ExportOptions(output=destination))

    assert json.loads(destination.read_text())["items"] == [manifest]


def test_dashboard_json_output_write_failure_returns_json(monkeypatch, tmp_path, capsys):
    monkeypatch.setattr(
        metabase_commands,
        "export_dashboard",
        lambda _source, _parameters, _consumed_parameter_ids, _allow_query_execution: {
            "version": 1,
            "dashboard": {"id": 42},
        },
    )
    monkeypatch.setattr(
        metabase_commands,
        "_write_manifest",
        Mock(side_effect=metabase_commands.MetabaseCliError("Could not write output file")),
    )

    with pytest.raises(SystemExit):
        metabase_commands.dashboard(
            ["42"],
            options=metabase_commands.ExportOptions(
                json_output=True,
                output=tmp_path / "dashboard.json",
            ),
        )

    captured = capsys.readouterr()
    assert json.loads(captured.out) == {"success": False, "error": "Could not write output file"}
    assert captured.err == ""


def test_manifest_output_parent_errors_use_cli_error(tmp_path):
    parent = tmp_path / "not-a-directory"
    parent.write_text("file")

    with pytest.raises(metabase_commands.MetabaseCliError, match="Could not write output file"):
        metabase_commands._write_manifest(parent / "dashboard.json", "{}")


def test_manifest_write_failure_does_not_leave_partial_output(monkeypatch, tmp_path):
    destination = tmp_path / "dashboard.json"
    monkeypatch.setattr(
        metabase_commands.os,
        "replace",
        Mock(side_effect=OSError("could not install output")),
    )

    with pytest.raises(metabase_commands.MetabaseCliError, match="Could not write output file"):
        metabase_commands._write_manifest(destination, '{"dashboard":')

    assert not destination.exists()
    assert list(tmp_path.iterdir()) == []


def test_manifest_atomically_overwrites_any_output_filename(monkeypatch, tmp_path):
    destination = tmp_path / "manifest"
    destination.write_text("old")
    monkeypatch.setattr(metabase_commands.UI, "success", Mock())

    metabase_commands._write_manifest(destination, "new")

    assert destination.read_text() == "new"


def test_dashboard_exports_multiple_sources_and_reports_errors(monkeypatch, capsys):
    def export(source, _parameters, _consumed_parameter_ids, _allow_query_execution):
        if source == "8":
            raise metabase_commands.MetabaseCliError("Dashboard is inaccessible")
        return {"version": 1, "dashboard": {"id": int(source)}}

    monkeypatch.setattr(metabase_commands, "export_dashboard", export)

    with pytest.raises(SystemExit):
        metabase_commands.dashboard(["7", "7", "8"], options=metabase_commands.ExportOptions(json_output=True))

    manifest = json.loads(capsys.readouterr().out)
    assert manifest["items"] == [{"version": 1, "dashboard": {"id": 7}}]
    assert manifest["errors"] == [{"source": "8", "reason": "Dashboard is inaccessible"}]
    assert manifest["summary"] == {"total": 2, "success": 1, "errors": 1}


def test_dashboard_batch_applies_parameter_overrides_only_where_consumed(monkeypatch, capsys):
    client = MagicMock()
    client.__enter__.return_value = client

    def fetch_dashboard(dashboard_id):
        parameter_id = "period" if dashboard_id == 7 else "region"
        question_id = dashboard_id + 10
        return {
            "id": dashboard_id,
            "parameters": [{"id": parameter_id, "type": "category"}],
            "dashcards": [
                {
                    "id": dashboard_id,
                    "card_id": question_id,
                    "card": {
                        "id": question_id,
                        "dataset_query": {"type": "query", "query": {"source-table": 3}},
                    },
                    "parameter_mappings": [
                        {
                            "parameter_id": parameter_id,
                            "card_id": question_id,
                            "target": ["dimension", ["field", 1, None]],
                        }
                    ],
                }
            ],
        }

    monkeypatch.setattr(
        metabase_commands,
        "_configured_metabase_url",
        lambda _resource="resource": "https://metabase.example.com",
    )
    monkeypatch.setattr(metabase_commands, "_metabase_client", Mock(return_value=client))
    client.fetch_dashboard.side_effect = fetch_dashboard

    metabase_commands.dashboard(
        ["7", "8"],
        options=metabase_commands.ExportOptions(
            parameters=['period="2026-09-01"'],
            json_output=True,
        ),
    )

    manifest = json.loads(capsys.readouterr().out)
    assert [item["dashboard"]["id"] for item in manifest["items"]] == [7, 8]
    assert manifest["errors"] == []


def test_dashboard_batch_preserves_exports_when_parameter_override_is_unused(monkeypatch, capsys):
    monkeypatch.setattr(
        metabase_commands,
        "export_dashboard",
        lambda source, _parameters, _consumed_parameter_ids, _allow_query_execution: {
            "version": 1,
            "dashboard": {"id": int(source)},
        },
    )

    with pytest.raises(SystemExit):
        metabase_commands.dashboard(
            ["7", "8"],
            options=metabase_commands.ExportOptions(parameters=["typo=true"], json_output=True),
        )

    manifest = json.loads(capsys.readouterr().out)
    assert [item["dashboard"]["id"] for item in manifest["items"]] == [7, 8]
    assert manifest["errors"][0]["source"] == "parameters"
    assert "typo" in manifest["errors"][0]["reason"]


def test_dashboard_single_failure_returns_batch_manifest(monkeypatch, capsys):
    def export(_source, _parameters, _consumed_parameter_ids, _allow_query_execution):
        raise metabase_commands.MetabaseCliError("Dashboard is inaccessible")

    monkeypatch.setattr(metabase_commands, "export_dashboard", export)

    with pytest.raises(SystemExit):
        metabase_commands.dashboard(["8"], options=metabase_commands.ExportOptions(json_output=True))

    manifest = json.loads(capsys.readouterr().out)
    assert manifest["items"] == []
    assert manifest["errors"] == [{"source": "8", "reason": "Dashboard is inaccessible"}]
    assert "summary" not in manifest


def test_collection_recursively_discovers_dashboards(monkeypatch):
    collection_items = {
        3: [
            {"model": "dashboard", "id": 7},
            {"model": "collection", "id": 4},
        ],
        4: [
            {"model": "dashboard", "id": 8},
            {"model": "dashboard", "id": 7},
        ],
    }
    client = Mock()
    client.fetch_collection_items.side_effect = collection_items.__getitem__

    assert metabase_commands._collection_dashboard_ids(client, 3, recursive=False) == [7]
    assert metabase_commands._collection_dashboard_ids(client, 3, recursive=True) == [7, 8]


def test_collection_accepts_override_consumed_by_only_one_dashboard(monkeypatch, capsys):
    client = MagicMock()
    client.__enter__.return_value = client

    def export_dashboard(
        _client,
        _base_url,
        dashboard_id,
        _parameter_values,
        consumed_parameter_ids,
        _allow_query_execution,
    ):
        if dashboard_id == 7:
            consumed_parameter_ids.add("period")
        return {"version": 1, "dashboard": {"id": dashboard_id}}

    monkeypatch.setattr(
        metabase_commands,
        "_resolve_collection_source",
        Mock(return_value=("https://metabase.example.com", 3)),
    )
    monkeypatch.setattr(metabase_commands, "_metabase_client", Mock(return_value=client))
    monkeypatch.setattr(metabase_commands, "_collection_dashboard_ids", Mock(return_value=[7, 8]))
    monkeypatch.setattr(metabase_commands, "_export_dashboard", export_dashboard)

    metabase_commands.collection(
        "3",
        options=metabase_commands.ExportOptions(
            parameters=['period="2026-09-01"'],
            json_output=True,
        ),
    )

    manifest = json.loads(capsys.readouterr().out)
    assert [item["dashboard"]["id"] for item in manifest["items"]] == [7, 8]
    assert manifest["errors"] == []


def test_collection_pagination_requires_total(monkeypatch):
    response = Mock()
    response.json.return_value = {"data": []}
    http_client = MagicMock()
    http_client.request.return_value = response
    monkeypatch.setattr(metabase_client.httpx, "Client", Mock(return_value=http_client))

    with pytest.raises(metabase_commands.MetabaseCliError, match="pagination"):
        with metabase_client.MetabaseClient("https://metabase.example.com", "test-key") as client:
            client.fetch_collection_items(3)


def test_collection_pagination_rejects_malformed_items(monkeypatch):
    response = Mock()
    response.json.return_value = {
        "data": [{"model": "dashboard", "id": 7}, "malformed"],
        "total": 2,
    }
    http_client = MagicMock()
    http_client.request.return_value = response
    monkeypatch.setattr(metabase_client.httpx, "Client", Mock(return_value=http_client))

    with pytest.raises(metabase_commands.MetabaseCliError, match="unexpected collection item"):
        with metabase_client.MetabaseClient("https://metabase.example.com", "test-key") as client:
            client.fetch_collection_items(3)


def test_collection_pagination_rejects_an_early_empty_page(monkeypatch):
    responses = [Mock(), Mock()]
    responses[0].json.return_value = {"data": [{"model": "dashboard", "id": 7}], "total": 2}
    responses[1].json.return_value = {"data": [], "total": 2}
    http_client = MagicMock()
    http_client.request.side_effect = responses
    monkeypatch.setattr(metabase_client.httpx, "Client", Mock(return_value=http_client))

    with pytest.raises(metabase_commands.MetabaseCliError, match="ended before"):
        with metabase_client.MetabaseClient("https://metabase.example.com", "test-key") as client:
            client.fetch_collection_items(3)


def test_collection_discovery_failure_returns_batch_manifest(monkeypatch, capsys):
    monkeypatch.setattr(
        metabase_commands,
        "_resolve_collection_source",
        Mock(side_effect=metabase_commands.MetabaseCliError("Collection is inaccessible")),
    )

    with pytest.raises(SystemExit):
        metabase_commands.collection(
            "3",
            recursive=True,
            options=metabase_commands.ExportOptions(json_output=True),
        )

    manifest = json.loads(capsys.readouterr().out)
    assert manifest["selection"] == {"mode": "collection", "source": "3", "recursive": True}
    assert manifest["resource"] == "dashboard"
    assert manifest["items"] == []
    assert manifest["errors"] == [{"source": "3", "reason": "Collection is inaccessible"}]
    assert "summary" not in manifest


def test_collection_discovery_failure_is_human_readable(monkeypatch, capsys):
    error = Mock()
    monkeypatch.setattr(
        metabase_commands,
        "_resolve_collection_source",
        Mock(side_effect=metabase_commands.MetabaseCliError("Collection is inaccessible")),
    )
    monkeypatch.setattr(metabase_commands.UI, "error", error)

    with pytest.raises(SystemExit):
        metabase_commands.collection("3")

    assert capsys.readouterr().out == ""
    error.assert_called_once_with("Collection is inaccessible")


def test_metabase_client_configures_auth_timeout_and_connection_retries(monkeypatch):
    response = Mock()
    response.json.return_value = {}
    http_client = MagicMock()
    http_client.request.return_value = response
    transport = object()
    transport_factory = Mock(return_value=transport)
    client_factory = Mock(return_value=http_client)
    monkeypatch.setattr(metabase_client.httpx, "HTTPTransport", transport_factory)
    monkeypatch.setattr(metabase_client.httpx, "Client", client_factory)

    with metabase_client.MetabaseClient("https://metabase.example.com", "test-key") as client:
        assert client.fetch_question(11) == {}

    transport_factory.assert_called_once_with(retries=metabase_client.HTTP_RETRIES)
    client_factory.assert_called_once_with(
        headers={"x-api-key": "test-key"},
        timeout=metabase_client.HTTP_TIMEOUT,
        transport=transport,
    )
    http_client.request.assert_called_once_with("GET", "https://metabase.example.com/api/card/11")
    http_client.close.assert_called_once_with()


def test_database_metadata_preserves_accessible_databases_and_failures(monkeypatch):
    fetch = Mock(
        side_effect=[
            {"id": 2, "name": "Analytics", "engine": "postgres"},
            metabase_commands.MetabaseCliError("Metabase database request failed (403): forbidden"),
        ]
    )
    client = Mock()
    client.fetch_database = fetch

    databases, limitations = metabase_commands._fetch_database_metadata(
        client,
        [2, 3],
    )

    assert databases == [{"id": 2, "name": "Analytics", "engine": "postgres"}]
    assert limitations == [
        {
            "kind": "database",
            "database_id": 3,
            "reason": "Metabase database request failed (403): forbidden",
        }
    ]
    assert fetch.call_args_list == [
        call(2),
        call(3),
    ]


def test_question_export_preserves_compiled_sql(monkeypatch):
    client = MagicMock()
    client.__enter__.return_value = client
    monkeypatch.setattr(metabase_commands, "_metabase_client", Mock(return_value=client))
    monkeypatch.setattr(
        metabase_commands,
        "_resolve_question_source",
        lambda _source: ("https://metabase.example.com", 11),
    )
    client.fetch_question.return_value = {
        "id": 11,
        "name": "Orders",
        "display": "bar",
        "database_id": 2,
        "dataset_query": {"type": "query", "database": 2, "query": {"source-table": 3}},
        "parameters": [
            {
                "id": "period",
                "type": "date/single",
                "target": ["dimension", ["field", 1, None]],
            }
        ],
    }
    client.compile_question.return_value = _compiled_response(
        "SELECT category, count(*) FROM orders GROUP BY category",
        [],
    )
    client.fetch_database.return_value = {"id": 2, "name": "Analytics", "engine": "postgres"}

    manifest = metabase_commands.export_question(
        "11",
        {"period": "2026-09-01"},
        allow_query_execution=True,
    )

    assert manifest["source"]["question_id"] == 11
    assert manifest["databases"] == [{"id": 2, "name": "Analytics", "engine": "postgres"}]
    assert manifest["question"]["sql"] == "SELECT category, count(*) FROM orders GROUP BY category"
    assert manifest["limitations"] == []
    client.fetch_database.assert_called_once_with(2)
    client.compile_question.assert_called_once_with(
        11,
        None,
        [
            {
                "id": "period",
                "type": "date/single",
                "target": ["dimension", ["field", 1, None]],
                "value": "2026-09-01",
            }
        ],
    )


def test_native_question_parameter_overrides_are_compiled(monkeypatch):
    client = MagicMock()
    client.__enter__.return_value = client
    monkeypatch.setattr(metabase_commands, "_metabase_client", Mock(return_value=client))
    monkeypatch.setattr(
        metabase_commands,
        "_resolve_question_source",
        lambda _source: ("https://metabase.example.com", 11),
    )
    client.fetch_question.return_value = {
        "id": 11,
        "name": "Orders",
        "dataset_query": {
            "type": "native",
            "native": {"query": "SELECT * FROM orders WHERE created_at >= {{period}}"},
        },
        "parameters": [
            {
                "id": "period",
                "type": "date/single",
                "target": ["variable", ["template-tag", "period"]],
            }
        ],
    }
    client.compile_question.return_value = _compiled_response(
        "SELECT * FROM orders WHERE created_at >= ?",
        ["2026-09-01"],
    )

    manifest = metabase_commands.export_question(
        "11",
        {"period": "2026-09-01"},
        allow_query_execution=True,
    )

    assert manifest["question"]["sql"] is None
    assert manifest["question"]["sql_parameters"] == ["2026-09-01"]
    assert manifest["limitations"] == [
        {
            "kind": "question",
            "question_id": 11,
            "question_name": "Orders",
            "reason": metabase_commands.BOUND_SQL_PARAMETERS_LIMITATION,
        }
    ]
    client.compile_question.assert_called_once_with(
        11,
        None,
        [
            {
                "id": "period",
                "type": "date/single",
                "target": ["variable", ["template-tag", "period"]],
                "value": "2026-09-01",
            }
        ],
    )


@pytest.mark.parametrize(
    ("native_sql", "parameters"),
    [
        (
            "SELECT * FROM orders WHERE status = {{status}}",
            [
                {
                    "id": "status",
                    "type": "category",
                    "target": ["variable", ["template-tag", "status"]],
                }
            ],
        ),
        ("SELECT * FROM orders\n[[WHERE status = 'active']]", []),
    ],
)
def test_unresolved_native_question_template_syntax_is_not_executable(monkeypatch, native_sql, parameters):
    client = MagicMock()
    client.__enter__.return_value = client
    monkeypatch.setattr(metabase_commands, "_metabase_client", Mock(return_value=client))
    monkeypatch.setattr(
        metabase_commands,
        "_resolve_question_source",
        lambda _source: ("https://metabase.example.com", 11),
    )
    client.fetch_question.return_value = {
        "id": 11,
        "name": "Orders",
        "dataset_query": {
            "type": "native",
            "native": {"query": native_sql},
        },
        "parameters": parameters,
    }
    client.compile_question.side_effect = metabase_commands.MetabaseCliError("Required parameter is missing")

    manifest = metabase_commands.export_question("11", allow_query_execution=True)

    assert manifest["question"]["native_sql"] == native_sql
    assert manifest["question"]["sql"] is None
    assert manifest["question"]["sql_parameters"] == []
    assert manifest["limitations"] == [
        {
            "kind": "question",
            "question_id": 11,
            "question_name": "Orders",
            "reason": "Required parameter is missing",
        }
    ]
    client.compile_question.assert_called_once_with(11, None, [])


def test_unmatched_parameter_override_is_rejected(monkeypatch):
    client = MagicMock()
    client.__enter__.return_value = client
    monkeypatch.setattr(metabase_commands, "_metabase_client", Mock(return_value=client))
    monkeypatch.setattr(
        metabase_commands,
        "_resolve_question_source",
        lambda _source: ("https://metabase.example.com", 11),
    )
    client.fetch_question.return_value = {
        "id": 11,
        "dataset_query": {"type": "native", "native": {"query": "SELECT * FROM orders"}},
    }

    with pytest.raises(metabase_commands.MetabaseCliError, match="Unknown or unused.*typo"):
        metabase_commands.export_question("11", {"typo": "2026-09-01"})
