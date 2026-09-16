import json
from unittest.mock import Mock

import pytest

import nao_core.commands.metabase as metabase_commands


def test_metabase_sources_accept_ids_or_urls(monkeypatch):
    monkeypatch.setenv("METABASE_URL", "https://configured.example.com/metabase/")

    assert metabase_commands._resolve_dashboard_source("42") == (
        "https://configured.example.com/metabase",
        42,
    )
    assert metabase_commands._resolve_dashboard_source("https://source.example.com/metabase/dashboard/7-sales") == (
        "https://source.example.com/metabase",
        7,
    )

    with pytest.raises(metabase_commands.MetabaseImportError):
        metabase_commands._resolve_dashboard_source("dashboard-42")

    assert metabase_commands._resolve_question_source("https://source.example.com/metabase/question/8-orders") == (
        "https://source.example.com/metabase",
        8,
    )
    assert metabase_commands._resolve_collection_source("https://source.example.com/metabase/collection/3-finance") == (
        "https://source.example.com/metabase",
        3,
    )


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
        {11: {"sql": "SELECT category, count(*) FROM orders GROUP BY category", "parameters": []}},
    )

    card = manifest["dashboard"]["cards"][0]
    mbql_question = manifest["dashboard"]["cards"][1]["question"]
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


def test_failed_mbql_compilation_is_reported_once(monkeypatch):
    compile_question = Mock(side_effect=metabase_commands.MetabaseImportError("Compilation failed"))
    monkeypatch.setattr(metabase_commands, "_compile_question", compile_question)
    question = {
        "id": 11,
        "name": "Orders",
        "dataset_query": {"type": "query", "query": {"source-table": 3}},
    }

    compiled, limitations = metabase_commands._compile_mbql_queries(
        "https://metabase.example.com",
        42,
        {"dashcards": [{"card": question}, {"card": question}]},
    )

    assert compiled == {}
    assert limitations == [{"questionId": 11, "questionName": "Orders", "reason": "Compilation failed"}]
    compile_question.assert_called_once_with("https://metabase.example.com", 42, 11)


def test_dashboard_prints_compact_json(monkeypatch, capsys):
    manifest = {"schemaVersion": 1, "dashboard": {"id": 42}}
    monkeypatch.setattr(metabase_commands, "export_dashboard", lambda _source: manifest)

    metabase_commands.dashboard(["42"], json_output=True)

    output = capsys.readouterr().out
    assert json.loads(output) == manifest
    assert output == '{"schemaVersion":1,"dashboard":{"id":42}}\n'


def test_dashboard_writes_manifest_to_output(monkeypatch, tmp_path):
    manifest = {"schemaVersion": 1, "dashboard": {"id": 42}}
    destination = tmp_path / "exports" / "dashboard.json"
    monkeypatch.setattr(metabase_commands, "export_dashboard", lambda _source: manifest)
    monkeypatch.setattr(metabase_commands.UI, "success", lambda _message: None)

    metabase_commands.dashboard(["42"], output=destination)

    assert json.loads(destination.read_text()) == manifest


def test_dashboard_exports_multiple_sources_and_reports_failures(monkeypatch, capsys):
    def export(source):
        if source == "8":
            raise metabase_commands.MetabaseImportError("Dashboard is inaccessible")
        return {"schemaVersion": 1, "dashboard": {"id": int(source)}}

    monkeypatch.setattr(metabase_commands, "export_dashboard", export)

    with pytest.raises(SystemExit):
        metabase_commands.dashboard(["7", "7", "8"], json_output=True)

    manifest = json.loads(capsys.readouterr().out)
    assert manifest["dashboards"] == [{"schemaVersion": 1, "dashboard": {"id": 7}}]
    assert manifest["failures"] == [{"source": "8", "reason": "Dashboard is inaccessible"}]
    assert manifest["summary"] == {"selected": 2, "exported": 1, "failed": 1}


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
        },
    )
    compile_question = Mock(
        return_value={"sql": "SELECT category, count(*) FROM orders GROUP BY category", "parameters": []}
    )
    monkeypatch.setattr(metabase_commands, "_compile_question", compile_question)

    manifest = metabase_commands.export_question("11")

    assert manifest["source"]["questionId"] == 11
    assert manifest["question"]["sql"] == "SELECT category, count(*) FROM orders GROUP BY category"
    assert manifest["limitations"] == []
    compile_question.assert_called_once_with("https://metabase.example.com", None, 11)
