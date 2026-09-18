import json
from unittest.mock import MagicMock, Mock, call

import pytest

import nao_core.commands.metabase as metabase_commands


def test_configure_masks_api_key_input_and_saves_credentials_to_project_env(monkeypatch, tmp_path):
    project_path = tmp_path / "project"
    nested_path = project_path / "agent"
    nested_path.mkdir(parents=True)
    (tmp_path / ".env").write_text("PARENT=true\n")
    (project_path / "nao_config.yaml").touch()
    (project_path / ".gitignore").write_text("!.env\n")
    env_path = project_path / ".env"
    ask_text = Mock(side_effect=["https://metabase.example.com/", "secret-key"])
    set_key = Mock()
    monkeypatch.chdir(nested_path)
    monkeypatch.delenv("METABASE_URL", raising=False)
    monkeypatch.setattr(metabase_commands, "ask_text", ask_text)
    monkeypatch.setattr(metabase_commands, "set_key", set_key)
    monkeypatch.setattr(metabase_commands.UI, "success", Mock())

    metabase_commands.configure()

    assert ask_text.call_args_list == [
        call("Metabase URL:", default="", required_field=True),
        call("Metabase API key:", password=True, required_field=True),
    ]
    assert set_key.call_args_list == [
        call(env_path, "METABASE_URL", "https://metabase.example.com", quote_mode="always"),
        call(env_path, "METABASE_API_KEY", "secret-key", quote_mode="always"),
    ]
    assert (project_path / ".gitignore").read_text() == "!.env\n.env\n"
    assert (tmp_path / ".env").read_text() == "PARENT=true\n"


def test_configure_rejects_directories_outside_a_nao_project(monkeypatch, tmp_path):
    ask_text = Mock()
    error = Mock()
    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr(metabase_commands, "ask_text", ask_text)
    monkeypatch.setattr(metabase_commands.UI, "error", error)

    with pytest.raises(SystemExit):
        metabase_commands.configure()

    ask_text.assert_not_called()
    error.assert_called_once_with(
        "No nao_config.yaml found. Run 'nao import metabase configure' from inside a nao project."
    )


def test_configure_rejects_tracked_project_env_before_prompting(monkeypatch, tmp_path):
    (tmp_path / "nao_config.yaml").touch()
    ask_text = Mock()
    error = Mock()
    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr(metabase_commands, "_is_git_tracked", lambda _path: True)
    monkeypatch.setattr(metabase_commands, "ask_text", ask_text)
    monkeypatch.setattr(metabase_commands.UI, "error", error)

    with pytest.raises(SystemExit):
        metabase_commands.configure()

    ask_text.assert_not_called()
    error.assert_called_once_with(
        f"Refusing to write Metabase credentials to tracked file {tmp_path / '.env'}. "
        "Remove it from Git tracking before configuring Metabase."
    )


@pytest.mark.parametrize(
    ("url", "normalized_url"),
    [
        ("https://METABASE.example.com:443/metabase/", "https://metabase.example.com:443/metabase"),
        ("http://localhost:3000/", "http://localhost:3000"),
        ("http://127.0.0.1:3000/", "http://127.0.0.1:3000"),
        ("http://[::1]:3000/", "http://[::1]:3000"),
    ],
)
def test_metabase_url_normalization_accepts_https_and_loopback_http(url, normalized_url):
    assert metabase_commands._normalize_metabase_url(url) == normalized_url


@pytest.mark.parametrize(
    "url",
    [
        "http://metabase.example.com",
        "https://user:password@metabase.example.com",
        "https://metabase.example.com?foo=bar",
        "https://metabase.example.com#fragment",
    ],
)
def test_metabase_url_normalization_rejects_unsafe_components(url):
    with pytest.raises(metabase_commands.MetabaseCliError):
        metabase_commands._normalize_metabase_url(url)


def test_metabase_sources_accept_ids_or_urls(monkeypatch):
    monkeypatch.setenv("METABASE_URL", "https://configured.example.com/metabase/")

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


def test_metabase_source_url_rejects_unconfigured_origin(monkeypatch):
    monkeypatch.setenv("METABASE_URL", "https://configured.example.com/metabase")

    with pytest.raises(metabase_commands.MetabaseCliError, match="configured by METABASE_URL"):
        metabase_commands._resolve_dashboard_source("https://attacker.example.com/dashboard/7")
    with pytest.raises(metabase_commands.MetabaseCliError, match="configured by METABASE_URL"):
        metabase_commands._resolve_dashboard_source("http://configured.example.com/dashboard/7")
    with pytest.raises(metabase_commands.MetabaseCliError, match="base path"):
        metabase_commands._resolve_dashboard_source("https://configured.example.com/other/dashboard/7")


@pytest.mark.parametrize(
    "url",
    [
        "https://user:password@configured.example.com/metabase/dashboard/7",
        "https://configured.example.com/metabase/dashboard/7?token=secret",
        "https://configured.example.com/metabase/dashboard/7#fragment",
    ],
)
def test_metabase_source_url_rejects_unsafe_components(monkeypatch, url):
    monkeypatch.setenv("METABASE_URL", "https://configured.example.com/metabase")

    with pytest.raises(metabase_commands.MetabaseCliError, match="must not include"):
        metabase_commands._resolve_dashboard_source(url)


@pytest.mark.parametrize(
    "dashboard",
    [
        {"id": 42},
        {"id": 42, "dashcards": {}, "tabs": []},
        {"id": 42, "dashcards": [], "tabs": {}},
        {"id": 42, "dashcards": [{"card_id": 9, "card": {"id": 9}}]},
    ],
)
def test_fetch_dashboard_rejects_malformed_responses(monkeypatch, dashboard):
    monkeypatch.setattr(metabase_commands, "_fetch_metabase_object", lambda _url, _resource: dashboard)

    with pytest.raises(metabase_commands.MetabaseCliError, match="unexpected dashboard response"):
        metabase_commands._fetch_dashboard("https://metabase.example.com", 42)


@pytest.mark.parametrize(
    "question",
    [
        {"id": 12, "dataset_query": {}},
        {"id": 11},
        {"id": 11, "dataset_query": {}, "visualization_settings": []},
        {"id": 11, "dataset_query": {}, "result_metadata": {}},
    ],
)
def test_fetch_question_rejects_malformed_responses(monkeypatch, question):
    monkeypatch.setattr(metabase_commands, "_fetch_metabase_object", lambda _url, _resource: question)

    with pytest.raises(metabase_commands.MetabaseCliError, match="unexpected question response"):
        metabase_commands._fetch_question("https://metabase.example.com", 11)


def test_manifest_preserves_layout_visualization_and_query():
    dataset_query = {
        "type": "native",
        "database": 2,
        "native": {"query": "SELECT month, revenue FROM sales"},
    }
    manifest = metabase_commands._build_manifest(
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
    assert card["visualizationSettings"] == {"graph.show_values": True}
    assert card["effectiveFilterIds"] == ["period"]
    assert card["question"]["datasetQuery"] == dataset_query
    assert card["question"]["nativeSql"] == "SELECT month, revenue FROM sales"
    assert card["question"]["sql"] == "SELECT month, revenue FROM sales"
    assert card["series"][0]["question"]["nativeSql"] == "SELECT month, forecast FROM forecast"
    assert mbql_question["mbql"]["query"] == {"source-table": 3}
    assert mbql_question["sql"] == "SELECT category, count(*) FROM orders GROUP BY category"


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
    post = Mock(return_value=response)
    monkeypatch.setenv("METABASE_API_KEY", "test-key")
    monkeypatch.setattr(metabase_commands.httpx, "post", post)

    compiled = metabase_commands._compile_question("https://metabase.example.com", dashboard_id, 11)

    assert compiled["sql"] == "SELECT category, count(*) FROM orders GROUP BY category"
    post.assert_called_once_with(
        "https://metabase.example.com/api/card/11/query",
        headers={"x-api-key": "test-key"},
        json=body,
        timeout=metabase_commands.HTTP_TIMEOUT,
    )


def test_failed_mbql_compilation_identifies_the_placement(monkeypatch):
    compile_question = Mock(side_effect=metabase_commands.MetabaseCliError("Compilation failed"))
    monkeypatch.setattr(metabase_commands, "_compile_question", compile_question)
    question = {
        "id": 11,
        "name": "Orders",
        "dataset_query": {"type": "query", "query": {"source-table": 3}},
    }

    compiled, limitations = metabase_commands._compile_mbql_queries(
        "https://metabase.example.com",
        42,
        {"dashcards": [{"id": 7, "card": question}]},
        allow_query_execution=True,
    )

    assert compiled == {}
    assert limitations == [
        {"placementId": 7, "questionId": 11, "questionName": "Orders", "reason": "Compilation failed"}
    ]
    compile_question.assert_called_once_with("https://metabase.example.com", 42, 11, [])


def test_dashboard_compilation_requires_explicit_query_execution(monkeypatch):
    compile_question = Mock()
    monkeypatch.setattr(metabase_commands, "_compile_question", compile_question)
    question = {
        "id": 11,
        "name": "Orders",
        "dataset_query": {"type": "query", "query": {"source-table": 3}},
    }

    compiled, limitations = metabase_commands._compile_mbql_queries(
        "https://metabase.example.com",
        42,
        {"dashcards": [{"id": 7, "card": question}]},
    )

    assert compiled == {}
    assert limitations == [
        {
            "placementId": 7,
            "questionId": 11,
            "questionName": "Orders",
            "reason": metabase_commands.QUERY_EXECUTION_REQUIRED_LIMITATION,
        }
    ]
    compile_question.assert_not_called()


def test_dashboard_compilation_preserves_each_placement_parameter_context(monkeypatch):
    compile_question = Mock(
        side_effect=[
            {"sql": "SELECT * FROM orders WHERE period = ?", "parameters": ["2026-09-01"]},
            {"sql": "SELECT * FROM orders WHERE region = ?", "parameters": ["France"]},
        ]
    )
    monkeypatch.setattr(metabase_commands, "_compile_question", compile_question)
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

    compiled, limitations = metabase_commands._compile_mbql_queries(
        "https://metabase.example.com",
        42,
        dashboard,
        {"period": "2026-09-01"},
        allow_query_execution=True,
    )

    assert limitations == [
        {
            "placementId": 7,
            "questionId": 11,
            "questionName": "Orders",
            "reason": metabase_commands.BOUND_SQL_PARAMETERS_LIMITATION,
        },
        {
            "placementId": 8,
            "questionId": 11,
            "questionName": "Orders",
            "reason": metabase_commands.BOUND_SQL_PARAMETERS_LIMITATION,
        },
    ]
    assert compile_question.call_args_list == [
        call(
            "https://metabase.example.com",
            42,
            11,
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
            "https://metabase.example.com",
            42,
            11,
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
    manifest = metabase_commands._build_manifest(
        "https://metabase.example.com",
        dashboard,
        compiled,
    )
    assert manifest["dashboard"]["cards"][0]["question"]["sql"] is None
    assert manifest["dashboard"]["cards"][1]["question"]["sql"] is None
    assert manifest["dashboard"]["cards"][0]["question"]["sqlParameters"] == ["2026-09-01"]
    assert manifest["dashboard"]["cards"][1]["question"]["sqlParameters"] == ["France"]

    with pytest.raises(metabase_commands.MetabaseCliError, match="Unknown or unused.*typo"):
        metabase_commands._compile_mbql_queries(
            "https://metabase.example.com",
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
    manifest = {"schemaVersion": 1, "dashboard": {"id": 42}}
    monkeypatch.setattr(
        metabase_commands,
        "export_dashboard",
        lambda _source, _parameters, _consumed_parameter_ids, _allow_query_execution: manifest,
    )

    metabase_commands.dashboard(["42"], json_output=True)

    output = capsys.readouterr().out
    batch = {
        "schemaVersion": 1,
        "type": "metabase-dashboard-batch",
        "selection": {"mode": "explicit", "sources": ["42"]},
        "dashboards": [manifest],
        "failures": [],
        "summary": {"selected": 1, "exported": 1, "failed": 0},
    }
    assert json.loads(output) == batch
    assert output == json.dumps(batch, ensure_ascii=False, separators=(",", ":")) + "\n"


def test_dashboard_returns_json_for_command_errors(monkeypatch, capsys):
    with pytest.raises(SystemExit):
        metabase_commands.dashboard(["42"], parameters=["invalid"], json_output=True)

    manifest = json.loads(capsys.readouterr().out)
    assert manifest["dashboards"] == []
    assert manifest["failures"] == [{"source": "42", "reason": "Parameters must use ID=JSON format."}]


def test_dashboard_writes_manifest_to_output(monkeypatch, tmp_path):
    manifest = {"schemaVersion": 1, "dashboard": {"id": 42}}
    destination = tmp_path / "exports" / "dashboard.json"
    monkeypatch.setattr(
        metabase_commands,
        "export_dashboard",
        lambda _source, _parameters, _consumed_parameter_ids, _allow_query_execution: manifest,
    )
    monkeypatch.setattr(metabase_commands.UI, "success", lambda _message: None)

    metabase_commands.dashboard(["42"], output=destination)

    assert json.loads(destination.read_text())["dashboards"] == [manifest]


def test_manifest_output_parent_errors_use_cli_error(tmp_path):
    parent = tmp_path / "not-a-directory"
    parent.write_text("file")

    with pytest.raises(metabase_commands.MetabaseCliError, match="Could not write output file"):
        metabase_commands._write_manifest(parent / "dashboard.json", "{}")


def test_manifest_write_failure_does_not_leave_partial_output(monkeypatch, tmp_path):
    destination = tmp_path / "dashboard.json"
    monkeypatch.setattr(
        metabase_commands.os,
        "link",
        Mock(side_effect=OSError("could not install output")),
    )

    with pytest.raises(metabase_commands.MetabaseCliError, match="Could not write output file"):
        metabase_commands._write_manifest(destination, '{"dashboard":')

    assert not destination.exists()
    assert list(tmp_path.iterdir()) == []


def test_dashboard_exports_multiple_sources_and_reports_failures(monkeypatch, capsys):
    def export(source, _parameters, _consumed_parameter_ids, _allow_query_execution):
        if source == "8":
            raise metabase_commands.MetabaseCliError("Dashboard is inaccessible")
        return {"schemaVersion": 1, "dashboard": {"id": int(source)}}

    monkeypatch.setattr(metabase_commands, "export_dashboard", export)

    with pytest.raises(SystemExit):
        metabase_commands.dashboard(["7", "7", "8"], json_output=True)

    manifest = json.loads(capsys.readouterr().out)
    assert manifest["dashboards"] == [{"schemaVersion": 1, "dashboard": {"id": 7}}]
    assert manifest["failures"] == [{"source": "8", "reason": "Dashboard is inaccessible"}]
    assert manifest["summary"] == {"selected": 2, "exported": 1, "failed": 1}


def test_dashboard_batch_applies_parameter_overrides_only_where_consumed(monkeypatch, capsys):
    def fetch_dashboard(_base_url, dashboard_id):
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

    monkeypatch.setenv("METABASE_URL", "https://metabase.example.com")
    monkeypatch.setattr(metabase_commands, "_fetch_dashboard", fetch_dashboard)
    monkeypatch.setattr(
        metabase_commands,
        "_compile_question",
        Mock(return_value={"sql": "SELECT 1", "parameters": []}),
    )
    monkeypatch.setattr(metabase_commands, "_fetch_database_metadata", Mock(return_value=([], [])))

    metabase_commands.dashboard(["7", "8"], parameters=['period="2026-09-01"'], json_output=True)

    manifest = json.loads(capsys.readouterr().out)
    assert [item["dashboard"]["id"] for item in manifest["dashboards"]] == [7, 8]
    assert manifest["failures"] == []


def test_dashboard_single_failure_returns_batch_manifest(monkeypatch, capsys):
    def export(_source, _parameters, _consumed_parameter_ids, _allow_query_execution):
        raise metabase_commands.MetabaseCliError("Dashboard is inaccessible")

    monkeypatch.setattr(metabase_commands, "export_dashboard", export)

    with pytest.raises(SystemExit):
        metabase_commands.dashboard(["8"], json_output=True)

    manifest = json.loads(capsys.readouterr().out)
    assert manifest["dashboards"] == []
    assert manifest["failures"] == [{"source": "8", "reason": "Dashboard is inaccessible"}]
    assert manifest["summary"] == {"selected": 1, "exported": 0, "failed": 1}


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
    monkeypatch.setattr(
        metabase_commands,
        "_fetch_collection_items",
        lambda _base_url, collection_id: collection_items[collection_id],
    )

    assert metabase_commands._collection_dashboard_ids("https://metabase.example.com", 3, recursive=False) == [7]
    assert metabase_commands._collection_dashboard_ids("https://metabase.example.com", 3, recursive=True) == [7, 8]


def test_collection_accepts_override_consumed_by_only_one_dashboard(monkeypatch, capsys):
    def export_dashboard(
        _base_url,
        dashboard_id,
        _parameter_values,
        consumed_parameter_ids,
        _allow_query_execution,
    ):
        if dashboard_id == 7:
            consumed_parameter_ids.add("period")
        return {"schemaVersion": 1, "dashboard": {"id": dashboard_id}}

    monkeypatch.setattr(
        metabase_commands,
        "_resolve_collection_source",
        Mock(return_value=("https://metabase.example.com", 3)),
    )
    monkeypatch.setattr(metabase_commands, "_collection_dashboard_ids", Mock(return_value=[7, 8]))
    monkeypatch.setattr(metabase_commands, "_export_dashboard", export_dashboard)

    metabase_commands.collection("3", parameters=['period="2026-09-01"'], json_output=True)

    manifest = json.loads(capsys.readouterr().out)
    assert [item["dashboard"]["id"] for item in manifest["dashboards"]] == [7, 8]
    assert manifest["failures"] == []


def test_collection_pagination_requires_total(monkeypatch):
    response = Mock()
    response.json.return_value = {"data": []}
    monkeypatch.setenv("METABASE_API_KEY", "test-key")
    monkeypatch.setattr(metabase_commands, "_metabase_get", Mock(return_value=response))

    with pytest.raises(metabase_commands.MetabaseCliError, match="pagination"):
        metabase_commands._fetch_collection_items("https://metabase.example.com", 3)


def test_collection_pagination_rejects_an_early_empty_page(monkeypatch):
    responses = [Mock(), Mock()]
    responses[0].json.return_value = {"data": [{"model": "dashboard", "id": 7}], "total": 2}
    responses[1].json.return_value = {"data": [], "total": 2}
    monkeypatch.setenv("METABASE_API_KEY", "test-key")
    monkeypatch.setattr(metabase_commands, "_metabase_get", Mock(side_effect=responses))

    with pytest.raises(metabase_commands.MetabaseCliError, match="ended before"):
        metabase_commands._fetch_collection_items("https://metabase.example.com", 3)


def test_collection_discovery_failure_returns_batch_manifest(monkeypatch, capsys):
    monkeypatch.setattr(
        metabase_commands,
        "_resolve_collection_source",
        Mock(side_effect=metabase_commands.MetabaseCliError("Collection is inaccessible")),
    )

    with pytest.raises(SystemExit):
        metabase_commands.collection("3", recursive=True, json_output=True)

    manifest = json.loads(capsys.readouterr().out)
    assert manifest["selection"] == {"mode": "collection", "source": "3", "recursive": True}
    assert manifest["dashboards"] == []
    assert manifest["failures"] == [{"source": "3", "reason": "Collection is inaccessible"}]
    assert manifest["summary"] == {"selected": 1, "exported": 0, "failed": 1}


def test_metabase_get_enables_connection_retries(monkeypatch):
    response = Mock()
    client = MagicMock()
    client.__enter__.return_value = client
    client.get.return_value = response
    transport = object()
    transport_factory = Mock(return_value=transport)
    client_factory = Mock(return_value=client)
    monkeypatch.setattr(metabase_commands.httpx, "HTTPTransport", transport_factory)
    monkeypatch.setattr(metabase_commands.httpx, "Client", client_factory)

    assert metabase_commands._metabase_get("https://metabase.example.com/api/card/11", "test-key") is response
    transport_factory.assert_called_once_with(retries=metabase_commands.HTTP_RETRIES)
    client_factory.assert_called_once_with(
        headers={"x-api-key": "test-key"},
        timeout=metabase_commands.HTTP_TIMEOUT,
        transport=transport,
    )
    client.get.assert_called_once_with("https://metabase.example.com/api/card/11")


def test_database_metadata_preserves_accessible_databases_and_failures(monkeypatch):
    fetch = Mock(
        side_effect=[
            {"id": 2, "name": "Analytics", "engine": "postgres"},
            metabase_commands.MetabaseCliError("Metabase database request failed (403): forbidden"),
        ]
    )
    monkeypatch.setattr(metabase_commands, "_fetch_metabase_object", fetch)

    databases, limitations = metabase_commands._fetch_database_metadata(
        "https://metabase.example.com",
        [2, 3],
    )

    assert databases == [{"id": 2, "name": "Analytics", "engine": "postgres"}]
    assert limitations == [
        {
            "databaseId": 3,
            "reason": "Metabase database request failed (403): forbidden",
        }
    ]
    assert fetch.call_args_list == [
        call("https://metabase.example.com/api/database/2", "database"),
        call("https://metabase.example.com/api/database/3", "database"),
    ]


def test_question_export_preserves_compiled_sql(monkeypatch):
    monkeypatch.setattr(
        metabase_commands,
        "_resolve_question_source",
        lambda _source: ("https://metabase.example.com", 11),
    )
    monkeypatch.setattr(
        metabase_commands,
        "_fetch_question",
        lambda _base_url, _question_id: {
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
        },
    )
    compile_question = Mock(
        return_value={"sql": "SELECT category, count(*) FROM orders GROUP BY category", "parameters": []}
    )
    monkeypatch.setattr(metabase_commands, "_compile_question", compile_question)
    fetch_database_metadata = Mock(return_value=([{"id": 2, "name": "Analytics", "engine": "postgres"}], []))
    monkeypatch.setattr(metabase_commands, "_fetch_database_metadata", fetch_database_metadata)

    manifest = metabase_commands.export_question(
        "11",
        {"period": "2026-09-01"},
        allow_query_execution=True,
    )

    assert manifest["source"]["questionId"] == 11
    assert manifest["databases"] == [{"id": 2, "name": "Analytics", "engine": "postgres"}]
    assert manifest["question"]["sql"] == "SELECT category, count(*) FROM orders GROUP BY category"
    assert manifest["limitations"] == []
    fetch_database_metadata.assert_called_once_with("https://metabase.example.com", [2])
    compile_question.assert_called_once_with(
        "https://metabase.example.com",
        None,
        11,
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
    monkeypatch.setattr(
        metabase_commands,
        "_resolve_question_source",
        lambda _source: ("https://metabase.example.com", 11),
    )
    monkeypatch.setattr(
        metabase_commands,
        "_fetch_question",
        lambda _base_url, _question_id: {
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
        },
    )
    compile_question = Mock(
        return_value={
            "sql": "SELECT * FROM orders WHERE created_at >= ?",
            "parameters": ["2026-09-01"],
        }
    )
    monkeypatch.setattr(metabase_commands, "_compile_question", compile_question)

    manifest = metabase_commands.export_question(
        "11",
        {"period": "2026-09-01"},
        allow_query_execution=True,
    )

    assert manifest["question"]["sql"] is None
    assert manifest["question"]["sqlParameters"] == ["2026-09-01"]
    assert manifest["limitations"] == [
        {
            "questionId": 11,
            "questionName": "Orders",
            "reason": metabase_commands.BOUND_SQL_PARAMETERS_LIMITATION,
        }
    ]
    compile_question.assert_called_once_with(
        "https://metabase.example.com",
        None,
        11,
        [
            {
                "id": "period",
                "type": "date/single",
                "target": ["variable", ["template-tag", "period"]],
                "value": "2026-09-01",
            }
        ],
    )


def test_unresolved_native_question_template_is_not_executable(monkeypatch):
    monkeypatch.setattr(
        metabase_commands,
        "_resolve_question_source",
        lambda _source: ("https://metabase.example.com", 11),
    )
    monkeypatch.setattr(
        metabase_commands,
        "_fetch_question",
        lambda _base_url, _question_id: {
            "id": 11,
            "name": "Orders",
            "dataset_query": {
                "type": "native",
                "native": {"query": "SELECT * FROM orders WHERE status = {{status}}"},
            },
            "parameters": [
                {
                    "id": "status",
                    "type": "category",
                    "target": ["variable", ["template-tag", "status"]],
                }
            ],
        },
    )
    compile_question = Mock(side_effect=metabase_commands.MetabaseCliError("Required parameter is missing"))
    monkeypatch.setattr(metabase_commands, "_compile_question", compile_question)
    monkeypatch.setattr(metabase_commands, "_fetch_database_metadata", Mock(return_value=([], [])))

    manifest = metabase_commands.export_question("11", allow_query_execution=True)

    assert manifest["question"]["nativeSql"] == "SELECT * FROM orders WHERE status = {{status}}"
    assert manifest["question"]["sql"] is None
    assert manifest["question"]["sqlParameters"] == []
    assert manifest["limitations"] == [
        {
            "questionId": 11,
            "questionName": "Orders",
            "reason": "Required parameter is missing",
        }
    ]
    compile_question.assert_called_once_with("https://metabase.example.com", None, 11, [])


def test_unmatched_parameter_override_is_rejected(monkeypatch):
    monkeypatch.setattr(
        metabase_commands,
        "_resolve_question_source",
        lambda _source: ("https://metabase.example.com", 11),
    )
    monkeypatch.setattr(
        metabase_commands,
        "_fetch_question",
        lambda _base_url, _question_id: {
            "id": 11,
            "dataset_query": {"type": "native", "native": {"query": "SELECT * FROM orders"}},
        },
    )

    with pytest.raises(metabase_commands.MetabaseCliError, match="Unknown or unused.*typo"):
        metabase_commands.export_question("11", {"typo": "2026-09-01"})
