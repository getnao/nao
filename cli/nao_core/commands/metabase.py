import json
from typing import Annotated, Any
from urllib.parse import quote

from cyclopts import App, Parameter

from nao_core.ui import UI

from .migration_client import MigrationClient, MigrationError

metabase = App(name="metabase", help="Inspect a configured Metabase source.")


@metabase.command
def collections(
    *,
    server_name: str | None = None,
    project_id: str | None = None,
    json_output: Annotated[bool, Parameter(name="--json")] = False,
) -> None:
    """List Metabase collections."""
    result = _client(project_id, json_output).request("GET", "/collections", params={"server_name": server_name})
    if json_output:
        _print_json(result)
        return
    for collection in result["collections"]:
        UI.print(f"{collection['id']}\t{collection['name']}")


@metabase.command
def dashboards(
    *,
    collection_id: int | None = None,
    server_name: str | None = None,
    project_id: str | None = None,
    json_output: Annotated[bool, Parameter(name="--json")] = False,
) -> None:
    """List Metabase dashboards."""
    result = _client(project_id, json_output).request(
        "GET",
        "/dashboards",
        params={"collection_id": collection_id, "server_name": server_name},
    )
    if json_output:
        _print_json(result)
        return
    for dashboard_item in result["dashboards"]:
        UI.print(f"{dashboard_item['id']}\t{dashboard_item['name']}")


@metabase.command
def dashboard(
    id_or_name: str,
    *,
    server_name: str | None = None,
    project_id: str | None = None,
    json_output: Annotated[bool, Parameter(name="--json")] = False,
) -> None:
    """Read a Metabase dashboard by ID or exact name."""
    result = _client(project_id, json_output).request(
        "GET",
        f"/dashboards/{quote(id_or_name, safe='')}",
        params={"server_name": server_name},
    )
    _print_result(result, json_output)


@metabase.command
def card(
    card_id: int,
    *,
    server_name: str | None = None,
    project_id: str | None = None,
    json_output: Annotated[bool, Parameter(name="--json")] = False,
) -> None:
    """Read a Metabase card."""
    result = _client(project_id, json_output).request(
        "GET",
        f"/cards/{card_id}",
        params={"server_name": server_name},
    )
    _print_result(result, json_output)


@metabase.command(name="compile-card")
def compile_card(
    card_id: int,
    *,
    parameters: str | None = None,
    server_name: str | None = None,
    project_id: str | None = None,
    json_output: Annotated[bool, Parameter(name="--json")] = False,
) -> None:
    """Return SQL and any driver bindings for a Metabase card."""
    body = _card_body(server_name, parameters)
    result = _client(project_id, json_output).request(
        "POST",
        f"/cards/{card_id}/compile",
        body=body,
    )
    _print_result(result, json_output)


@metabase.command(name="execute-card")
def execute_card(
    card_id: int,
    *,
    parameters: str | None = None,
    server_name: str | None = None,
    project_id: str | None = None,
    json_output: Annotated[bool, Parameter(name="--json")] = False,
) -> None:
    """Execute a Metabase card read-only."""
    body = _card_body(server_name, parameters)
    result = _client(project_id, json_output).request(
        "POST",
        f"/cards/{card_id}/execute",
        body=body,
    )
    _print_result(result, json_output)


def _parse_parameters(value: str | None) -> list[Any] | None:
    if value is None:
        return None
    try:
        parsed = json.loads(value)
    except json.JSONDecodeError as error:
        raise MigrationError("Invalid --parameters JSON.") from error
    if not isinstance(parsed, list):
        raise MigrationError("--parameters must be a JSON array.")
    return parsed


def _card_body(server_name: str | None, parameters: str | None) -> dict[str, Any]:
    body: dict[str, Any] = {}
    if server_name is not None:
        body["server_name"] = server_name
    parsed_parameters = _parse_parameters(parameters)
    if parsed_parameters is not None:
        body["parameters"] = parsed_parameters
    return body


def _client(project_id: str | None, noninteractive: bool) -> MigrationClient:
    return MigrationClient(project_id=project_id, noninteractive=noninteractive)


def _print_result(result: dict[str, Any], json_output: bool) -> None:
    if json_output:
        _print_json(result)
        return
    if "dashboard" in result:
        dashboard_item = result["dashboard"]
        UI.print(f"{dashboard_item['id']}\t{dashboard_item['name']}\t{len(dashboard_item['cards'])} cards")
    elif "card" in result:
        card_item = result["card"]
        UI.print(f"{card_item['id']}\t{card_item['name']}\t{card_item['display']}")
    elif "query" in result:
        query = result["query"]
        print(query.get("compiledSql") or query.get("nativeSql") or "")
        if query.get("boundParameters"):
            UI.print(f"Bound parameters: {json.dumps(query['boundParameters'], separators=(',', ':'))}")
    else:
        card_result = result["result"]
        UI.print(f"{card_result['cardId']}\t{card_result['status']}\t{len(card_result['rows'])} rows")


def _print_json(result: dict[str, Any]) -> None:
    print(json.dumps(result, separators=(",", ":")))


__all__ = ["metabase"]
