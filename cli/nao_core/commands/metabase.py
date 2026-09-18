import json
import os
import re
from collections import deque
from ipaddress import ip_address
from pathlib import Path
from typing import Annotated, Any, Callable
from urllib.parse import ParseResult, urlparse, urlunparse

import httpx
from cyclopts import App, Parameter
from dotenv import find_dotenv, set_key

from nao_core.tracking import track_command
from nao_core.ui import UI, ask_text

metabase = App(name="metabase")
HTTP_TIMEOUT = 30
HTTP_RETRIES = 2
PAGE_SIZE = 100


class MetabaseCliError(RuntimeError):
    pass


@metabase.command
def configure() -> None:
    """Save Metabase import credentials in the project .env file."""
    metabase_url = ask_text(
        "Metabase URL:",
        default=os.getenv("METABASE_URL", ""),
        required_field=True,
    )
    api_key = ask_text("Metabase API key:", password=True, required_field=True)
    assert metabase_url is not None and api_key is not None

    try:
        metabase_url = _normalize_metabase_url(metabase_url)
        env_path = Path(find_dotenv(usecwd=True) or Path.cwd() / ".env")
        set_key(env_path, "METABASE_URL", metabase_url, quote_mode="always")
        set_key(env_path, "METABASE_API_KEY", api_key, quote_mode="always")
    except (MetabaseCliError, OSError) as error:
        UI.error(str(error))
        raise SystemExit(1)

    UI.success(f"Saved Metabase credentials to {env_path}")


@metabase.command
@track_command("import metabase dashboard")
def dashboard(
    sources: Annotated[list[str], Parameter(help="Numeric Metabase dashboard IDs or URLs.")],
    /,
    *,
    parameters: Annotated[
        list[str] | None,
        Parameter(
            name="--parameter",
            help='Set a dashboard filter as ID=JSON, for example period="2026-09-01".',
        ),
    ] = None,
    json_output: Annotated[
        bool,
        Parameter(name="--json", help="Print compact JSON for machine consumption."),
    ] = False,
    output: Annotated[
        Path | None,
        Parameter(name=["-o", "--output"], help="Write the import manifest to this JSON file."),
    ] = None,
) -> None:
    """Export one or more Metabase dashboards as nao import manifests."""
    _run_source_exports("dashboard", sources, export_dashboard, parameters, json_output, output)


@metabase.command
@track_command("import metabase question")
def question(
    sources: Annotated[list[str], Parameter(help="Numeric Metabase question IDs or URLs.")],
    /,
    *,
    parameters: Annotated[
        list[str] | None,
        Parameter(
            name="--parameter",
            help='Set a question parameter as ID=JSON, for example period="2026-09-01".',
        ),
    ] = None,
    json_output: Annotated[
        bool,
        Parameter(name="--json", help="Print compact JSON for machine consumption."),
    ] = False,
    output: Annotated[
        Path | None,
        Parameter(name=["-o", "--output"], help="Write the import manifest to this JSON file."),
    ] = None,
) -> None:
    """Export one or more Metabase questions as nao import manifests."""
    _run_source_exports("question", sources, export_question, parameters, json_output, output)


@metabase.command
@track_command("import metabase collection")
def collection(
    source: Annotated[str, Parameter(help="Numeric Metabase collection ID or URL.")],
    *,
    recursive: Annotated[
        bool,
        Parameter(help="Include dashboards from nested collections."),
    ] = False,
    parameters: Annotated[
        list[str] | None,
        Parameter(
            name="--parameter",
            help='Set a dashboard filter as ID=JSON, for example period="2026-09-01".',
        ),
    ] = None,
    json_output: Annotated[
        bool,
        Parameter(name="--json", help="Print compact JSON for machine consumption."),
    ] = False,
    output: Annotated[
        Path | None,
        Parameter(name=["-o", "--output"], help="Write the import manifest to this JSON file."),
    ] = None,
) -> None:
    """Export dashboards from a Metabase collection."""
    selection = {"mode": "collection", "source": source, "recursive": recursive}
    try:
        parameter_values = _parse_parameter_values(parameters)
        base_url, collection_id = _resolve_collection_source(source)
        dashboard_ids = _collection_dashboard_ids(base_url, collection_id, recursive)
        consumed_parameter_ids: set[str] = set()
        manifests, failures = _collect_exports(
            [str(dashboard_id) for dashboard_id in dashboard_ids],
            lambda dashboard_id: _export_dashboard(
                base_url,
                int(dashboard_id),
                parameter_values,
                consumed_parameter_ids,
            ),
        )
        _reject_unmatched_parameter_values(parameter_values, consumed_parameter_ids)
    except MetabaseCliError as error:
        manifests = []
        failures = [{"source": source, "reason": str(error)}]

    try:
        _emit_manifest(
            _build_batch_manifest("dashboard", manifests, failures, selection),
            json_output,
            output,
        )
    except MetabaseCliError as error:
        UI.error(str(error))
        raise SystemExit(1)
    if failures:
        raise SystemExit(1)


def _run_source_exports(
    resource: str,
    sources: list[str],
    exporter: Callable[[str, dict[str, Any], set[str] | None], dict[str, Any]],
    parameters: list[str] | None,
    json_output: bool,
    output: Path | None,
) -> None:
    if not sources:
        UI.error(f"At least one Metabase {resource} ID or URL is required.")
        raise SystemExit(1)

    try:
        parameter_values = _parse_parameter_values(parameters)
        consumed_parameter_ids: set[str] = set()
        manifests, failures = _collect_exports(
            sources,
            lambda source: exporter(source, parameter_values, consumed_parameter_ids),
        )
        _reject_unmatched_parameter_values(parameter_values, consumed_parameter_ids)
        _emit_manifest(
            _build_batch_manifest(resource, manifests, failures, {"mode": "explicit", "sources": sources}),
            json_output,
            output,
        )
    except MetabaseCliError as error:
        UI.error(str(error))
        raise SystemExit(1)
    if failures:
        raise SystemExit(1)


def _parse_parameter_values(parameters: list[str] | None) -> dict[str, Any]:
    values: dict[str, Any] = {}
    for parameter in parameters or []:
        parameter_id, separator, raw_value = parameter.partition("=")
        if not separator or not parameter_id:
            raise MetabaseCliError("Parameters must use ID=JSON format.")
        if parameter_id in values:
            raise MetabaseCliError(f"Parameter was provided more than once: {parameter_id}")
        try:
            values[parameter_id] = json.loads(raw_value)
        except json.JSONDecodeError as error:
            raise MetabaseCliError(f"Parameter {parameter_id} must contain a valid JSON value.") from error
    return values


def _collect_exports(
    sources: list[str],
    exporter: Callable[[str], dict[str, Any]],
) -> tuple[list[dict[str, Any]], list[dict[str, str]]]:
    manifests: list[dict[str, Any]] = []
    failures: list[dict[str, str]] = []
    for source in dict.fromkeys(sources):
        try:
            manifests.append(exporter(source))
        except MetabaseCliError as error:
            failures.append({"source": source, "reason": str(error)})
    return manifests, failures


def _build_batch_manifest(
    resource: str,
    manifests: list[dict[str, Any]],
    failures: list[dict[str, str]],
    selection: dict[str, Any],
) -> dict[str, Any]:
    return {
        "schemaVersion": 1,
        "type": f"metabase-{resource}-batch",
        "selection": selection,
        f"{resource}s": manifests,
        "failures": failures,
        "summary": {
            "selected": len(manifests) + len(failures),
            "exported": len(manifests),
            "failed": len(failures),
        },
    }


def _emit_manifest(manifest: dict[str, Any], json_output: bool, output: Path | None) -> None:
    serialized = (
        json.dumps(
            manifest,
            indent=None if json_output and output is None else 2,
            ensure_ascii=False,
            separators=(",", ":") if json_output and output is None else None,
        )
        + "\n"
    )
    if output is None:
        print(serialized, end="")
    else:
        _write_manifest(output, serialized)


def export_dashboard(
    source: str,
    parameter_values: dict[str, Any] | None = None,
    batch_consumed_parameter_ids: set[str] | None = None,
) -> dict[str, Any]:
    base_url, dashboard_id = _resolve_dashboard_source(source)
    return _export_dashboard(base_url, dashboard_id, parameter_values, batch_consumed_parameter_ids)


def _export_dashboard(
    base_url: str,
    dashboard_id: int,
    parameter_values: dict[str, Any] | None = None,
    batch_consumed_parameter_ids: set[str] | None = None,
) -> dict[str, Any]:
    dashboard_data = _fetch_dashboard(base_url, dashboard_id)
    compiled_queries, limitations = _compile_mbql_queries(
        base_url,
        dashboard_id,
        dashboard_data,
        parameter_values,
        batch_consumed_parameter_ids,
    )
    databases, database_limitations = _fetch_database_metadata(
        base_url,
        _dashboard_database_ids(dashboard_data),
    )
    return _build_manifest(
        base_url,
        dashboard_data,
        compiled_queries,
        limitations + database_limitations,
        databases,
    )


def export_question(
    source: str,
    parameter_values: dict[str, Any] | None = None,
    batch_consumed_parameter_ids: set[str] | None = None,
) -> dict[str, Any]:
    base_url, question_id = _resolve_question_source(source)
    question_data = _fetch_question(base_url, question_id)
    values = parameter_values or {}
    query_parameters, consumed_parameter_ids = _question_query_parameters(question_data, values)
    if batch_consumed_parameter_ids is None:
        _reject_unmatched_parameter_values(values, consumed_parameter_ids)
    else:
        batch_consumed_parameter_ids.update(consumed_parameter_ids)
    compiled_query: dict[str, Any] | None = None
    limitations: list[dict[str, Any]] = []
    if query_parameters or not _extract_native_sql(question_data.get("dataset_query")):
        try:
            compiled_query = _compile_question(
                base_url,
                None,
                question_id,
                query_parameters,
            )
        except MetabaseCliError as error:
            limitations.append(
                {
                    "questionId": question_id,
                    "questionName": question_data.get("name"),
                    "reason": str(error),
                }
            )
    databases, database_limitations = _fetch_database_metadata(
        base_url,
        _question_database_ids([question_data]),
    )
    return _build_question_manifest(
        base_url,
        question_data,
        compiled_query,
        limitations + database_limitations,
        databases,
    )


def _resolve_dashboard_source(source: str) -> tuple[str, int]:
    return _resolve_metabase_source(source, "dashboard")


def _resolve_question_source(source: str) -> tuple[str, int]:
    return _resolve_metabase_source(source, "question")


def _resolve_collection_source(source: str) -> tuple[str, int]:
    return _resolve_metabase_source(source, "collection")


def _resolve_metabase_source(source: str, resource: str) -> tuple[str, int]:
    if source.isascii() and source.isdecimal() and int(source) > 0:
        return _configured_metabase_url(resource), int(source)

    try:
        resource_url = urlparse(source)
    except ValueError:
        resource_url = None
    name = resource.capitalize()
    if resource_url is None:
        raise MetabaseCliError(f"{name} must be a positive numeric ID or a Metabase {resource} URL.")
    match = re.search(rf"/{resource}/([1-9]\d*)(?:[-/]|$)", resource_url.path)
    resource_origin = _url_origin(resource_url)
    if resource_origin is None or not match:
        raise MetabaseCliError(f"{name} must be a positive numeric ID or a Metabase {resource} URL.")

    base_url = _configured_metabase_url(resource)
    if resource_origin != _url_origin(urlparse(base_url)):
        raise MetabaseCliError(f"{name} URL must use the server configured by METABASE_URL.")
    return base_url, int(match.group(1))


def _configured_metabase_url(resource: str = "resource") -> str:
    base_url = os.getenv("METABASE_URL", "")
    if not base_url:
        raise MetabaseCliError(
            f"METABASE_URL is required to import a Metabase {resource}. "
            "Run 'nao import metabase configure' in your terminal."
        )
    return _normalize_metabase_url(base_url)


def _normalize_metabase_url(base_url: str) -> str:
    try:
        url = urlparse(base_url)
    except ValueError:
        url = None
    if url is None or _url_origin(url) is None:
        raise MetabaseCliError("METABASE_URL must be a valid HTTP(S) URL.")
    if url.username is not None or url.password is not None:
        raise MetabaseCliError("METABASE_URL must not include user information.")
    if url.query or url.fragment:
        raise MetabaseCliError("METABASE_URL must not include a query string or fragment.")

    hostname = url.hostname
    assert hostname is not None
    if url.scheme == "http" and not _is_loopback_hostname(hostname):
        raise MetabaseCliError("METABASE_URL must use HTTPS unless it targets a loopback address.")

    normalized_hostname = f"[{hostname.lower()}]" if ":" in hostname else hostname.lower()
    netloc = normalized_hostname
    if url.port is not None:
        netloc += f":{url.port}"
    return urlunparse((url.scheme, netloc, url.path.rstrip("/"), "", "", ""))


def _is_loopback_hostname(hostname: str) -> bool:
    if hostname.lower() == "localhost":
        return True
    try:
        return ip_address(hostname).is_loopback
    except ValueError:
        return False


def _url_origin(url: ParseResult) -> tuple[str, str, int] | None:
    if url.scheme not in {"http", "https"} or not url.hostname:
        return None
    try:
        port = url.port
    except ValueError:
        return None
    return url.scheme, url.hostname.lower(), port or (443 if url.scheme == "https" else 80)


def _fetch_dashboard(base_url: str, dashboard_id: int) -> dict[str, Any]:
    return _fetch_metabase_object(
        f"{base_url}/api/dashboard/{dashboard_id}",
        "dashboard",
    )


def _fetch_question(base_url: str, question_id: int) -> dict[str, Any]:
    return _fetch_metabase_object(
        f"{base_url}/api/card/{question_id}",
        "question",
    )


def _fetch_database_metadata(
    base_url: str,
    database_ids: list[int],
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    databases: list[dict[str, Any]] = []
    limitations: list[dict[str, Any]] = []
    for database_id in database_ids:
        try:
            data = _fetch_metabase_object(
                f"{base_url}/api/database/{database_id}",
                "database",
            )
        except MetabaseCliError as error:
            limitations.append({"databaseId": database_id, "reason": str(error)})
            continue
        databases.append(
            {
                "id": database_id,
                "name": data.get("name"),
                "engine": data.get("engine"),
            }
        )
    return databases, limitations


def _fetch_metabase_object(url: str, resource: str) -> dict[str, Any]:
    api_key = _configured_metabase_api_key(resource)

    try:
        response = _metabase_get(
            url,
            api_key,
        )
        response.raise_for_status()
    except httpx.HTTPStatusError as error:
        detail = error.response.text[:300]
        raise MetabaseCliError(
            f"Metabase {resource} request failed ({error.response.status_code}): {detail}"
        ) from error
    except httpx.RequestError as error:
        raise MetabaseCliError(f"Could not reach Metabase: {error}") from error

    try:
        data = response.json()
    except ValueError as error:
        raise MetabaseCliError("Metabase returned invalid JSON.") from error
    if not isinstance(data, dict):
        raise MetabaseCliError(f"Metabase returned an unexpected {resource} response.")
    return data


def _collection_dashboard_ids(base_url: str, collection_id: int, recursive: bool) -> list[int]:
    pending = deque([collection_id])
    visited: set[int] = set()
    dashboard_ids: list[int] = []
    seen_dashboards: set[int] = set()

    while pending:
        current_collection_id = pending.popleft()
        if current_collection_id in visited:
            continue
        visited.add(current_collection_id)

        for item in _fetch_collection_items(base_url, current_collection_id):
            item_id = item.get("id")
            if item.get("model") == "dashboard" and isinstance(item_id, int) and item_id not in seen_dashboards:
                dashboard_ids.append(item_id)
                seen_dashboards.add(item_id)
            elif recursive and item.get("model") == "collection" and isinstance(item_id, int):
                pending.append(item_id)

    return dashboard_ids


def _fetch_collection_items(base_url: str, collection_id: int) -> list[dict[str, Any]]:
    api_key = _configured_metabase_api_key("collection")

    items: list[dict[str, Any]] = []
    offset = 0
    while True:
        try:
            response = _metabase_get(
                f"{base_url}/api/collection/{collection_id}/items",
                api_key,
                params={"limit": PAGE_SIZE, "offset": offset},
            )
            response.raise_for_status()
        except httpx.HTTPStatusError as error:
            detail = error.response.text[:300]
            raise MetabaseCliError(
                f"Metabase collection request failed ({error.response.status_code}): {detail}"
            ) from error
        except httpx.RequestError as error:
            raise MetabaseCliError(f"Could not reach Metabase: {error}") from error

        try:
            page = response.json()
        except ValueError as error:
            raise MetabaseCliError("Metabase returned invalid JSON.") from error
        if not isinstance(page, dict) or not isinstance(page.get("data"), list):
            raise MetabaseCliError("Metabase returned an unexpected collection response.")
        total = page.get("total")
        if not isinstance(total, int) or isinstance(total, bool) or total < 0:
            raise MetabaseCliError("Metabase returned collection pagination without a valid total.")

        page_items = [item for item in page["data"] if isinstance(item, dict)]
        items.extend(page_items)
        offset += len(page["data"])
        if not page["data"] and offset < total:
            raise MetabaseCliError("Metabase collection pagination ended before reaching the reported total.")
        if offset >= total:
            return items


def _compile_mbql_queries(
    base_url: str,
    dashboard_id: int,
    dashboard: dict[str, Any],
    parameter_values: dict[str, Any] | None = None,
    batch_consumed_parameter_ids: set[str] | None = None,
) -> tuple[dict[tuple[int, int], dict[str, Any]], list[dict[str, Any]]]:
    values = parameter_values or {}
    contexts: list[tuple[int, dict[str, Any], list[dict[str, Any]]]] = []
    consumed_parameter_ids: set[str] = set()
    for placement_id, question, parameter_mappings in _dashboard_question_contexts(dashboard):
        query_parameters, consumed_ids = _mapped_query_parameters(
            dashboard.get("parameters"),
            parameter_mappings,
            values,
        )
        contexts.append((placement_id, question, query_parameters))
        consumed_parameter_ids.update(consumed_ids)
    if batch_consumed_parameter_ids is None:
        _reject_unmatched_parameter_values(values, consumed_parameter_ids)
    else:
        batch_consumed_parameter_ids.update(consumed_parameter_ids)

    compiled_queries: dict[tuple[int, int], dict[str, Any]] = {}
    limitations: list[dict[str, Any]] = []
    for placement_id, question, query_parameters in contexts:
        question_id = question.get("id")
        if not isinstance(question_id, int) or (
            not query_parameters and _extract_native_sql(question.get("dataset_query"))
        ):
            continue
        try:
            compiled_queries[(placement_id, question_id)] = _compile_question(
                base_url,
                dashboard_id,
                question_id,
                query_parameters,
            )
        except MetabaseCliError as error:
            limitations.append(
                {
                    "placementId": placement_id,
                    "questionId": question_id,
                    "questionName": question.get("name"),
                    "reason": str(error),
                }
            )
    return compiled_queries, limitations


def _dashboard_question_contexts(
    dashboard: dict[str, Any],
) -> list[tuple[int, dict[str, Any], list[dict[str, Any]]]]:
    contexts: list[tuple[int, dict[str, Any], list[dict[str, Any]]]] = []
    for card in dashboard.get("dashcards") or []:
        if not isinstance(card, dict) or not isinstance(card.get("id"), int):
            continue
        placement_id = card["id"]
        if isinstance(card.get("card"), dict):
            question = card["card"]
            contexts.append((placement_id, question, _parameter_mappings_for_question(card, question.get("id"))))
        contexts.extend(
            (placement_id, series, _parameter_mappings_for_question(card, series.get("id")))
            for series in (card.get("series") or [])
            if isinstance(series, dict)
        )
    return contexts


def _compile_question(
    base_url: str,
    dashboard_id: int | None,
    question_id: int,
    parameters: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    api_key = _configured_metabase_api_key("question")

    body: dict[str, Any] = {"parameters": parameters or []}
    if dashboard_id is not None:
        body["dashboard_id"] = dashboard_id

    try:
        response = httpx.post(
            f"{base_url}/api/card/{question_id}/query",
            headers={"x-api-key": api_key},
            json=body,
            timeout=HTTP_TIMEOUT,
        )
        response.raise_for_status()
    except httpx.HTTPStatusError as error:
        detail = error.response.text[:300]
        raise MetabaseCliError(f"Question compilation failed ({error.response.status_code}): {detail}") from error
    except httpx.RequestError as error:
        raise MetabaseCliError(f"Could not compile Metabase question: {error}") from error

    try:
        result = response.json()
    except ValueError as error:
        raise MetabaseCliError("Metabase returned invalid JSON while compiling the question.") from error
    compiled_query = _extract_compiled_query(result)
    if compiled_query is None:
        raise MetabaseCliError("Metabase did not return compiled SQL for this question.")
    return compiled_query


def _configured_metabase_api_key(resource: str) -> str:
    api_key = os.getenv("METABASE_API_KEY")
    if not api_key:
        raise MetabaseCliError(
            f"METABASE_API_KEY is required to read a Metabase {resource}. "
            "Run 'nao import metabase configure' in your terminal."
        )
    return api_key


def _question_query_parameters(
    question: dict[str, Any],
    values: dict[str, Any],
) -> tuple[list[dict[str, Any]], set[str]]:
    definitions = question.get("parameters")
    if not isinstance(definitions, list):
        return [], set()
    mappings = [
        {"parameter_id": definition.get("id"), "target": definition.get("target")}
        for definition in definitions
        if isinstance(definition, dict)
    ]
    return _mapped_query_parameters(definitions, mappings, values)


def _mapped_query_parameters(
    definitions: Any,
    mappings: list[dict[str, Any]],
    values: dict[str, Any],
) -> tuple[list[dict[str, Any]], set[str]]:
    if not isinstance(definitions, list):
        return [], set()
    definitions_by_id = {
        definition["id"]: definition
        for definition in definitions
        if isinstance(definition, dict) and isinstance(definition.get("id"), str)
    }
    parameters: list[dict[str, Any]] = []
    consumed_parameter_ids: set[str] = set()
    for mapping in mappings:
        parameter_id = mapping.get("parameter_id")
        definition = definitions_by_id.get(parameter_id)
        if definition is None or not isinstance(definition.get("type"), str) or mapping.get("target") is None:
            continue
        if parameter_id in values:
            value = values[parameter_id]
            consumed_parameter_ids.add(parameter_id)
        elif definition.get("default") is not None:
            value = definition["default"]
        else:
            continue
        parameters.append(
            {
                "id": parameter_id,
                "type": definition["type"],
                "target": mapping["target"],
                "value": value,
            }
        )
    return parameters, consumed_parameter_ids


def _reject_unmatched_parameter_values(values: dict[str, Any], consumed_parameter_ids: set[str]) -> None:
    unmatched_parameter_ids = sorted(values.keys() - consumed_parameter_ids)
    if unmatched_parameter_ids:
        raise MetabaseCliError(f"Unknown or unused parameter overrides: {', '.join(unmatched_parameter_ids)}")


def _parameter_mappings_for_question(card: dict[str, Any], question_id: Any) -> list[dict[str, Any]]:
    mappings = card.get("parameter_mappings")
    if not isinstance(mappings, list):
        return []
    return [mapping for mapping in mappings if isinstance(mapping, dict) and mapping.get("card_id") == question_id]


def _metabase_get(url: str, api_key: str, **kwargs: Any) -> httpx.Response:
    transport = httpx.HTTPTransport(retries=HTTP_RETRIES)
    with httpx.Client(
        headers={"x-api-key": api_key},
        timeout=HTTP_TIMEOUT,
        transport=transport,
    ) as client:
        return client.get(url, **kwargs)


def _extract_compiled_query(result: Any) -> dict[str, Any] | None:
    if not isinstance(result, dict):
        return None
    data = result.get("data") if isinstance(result.get("data"), dict) else result
    native_form = data.get("native_form") if isinstance(data.get("native_form"), dict) else data.get("nativeForm")
    if not isinstance(native_form, dict):
        return None
    sql = native_form.get("query") or native_form.get("sql")
    if not isinstance(sql, str) or not sql.strip():
        return None
    parameters = native_form.get("params")
    return {
        "sql": sql,
        "parameters": parameters if isinstance(parameters, list) else [],
    }


def _build_question_manifest(
    base_url: str,
    question: dict[str, Any],
    compiled_query: dict[str, Any] | None = None,
    limitations: list[dict[str, Any]] | None = None,
    databases: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    return {
        "schemaVersion": 1,
        "source": {
            "type": "metabase",
            "url": base_url,
            "questionId": question.get("id"),
        },
        "databases": databases or [],
        "question": _compact_question(question, compiled_query),
        "limitations": limitations or [],
    }


def _build_manifest(
    base_url: str,
    dashboard: dict[str, Any],
    compiled_queries: dict[tuple[int, int], dict[str, Any]] | None = None,
    limitations: list[dict[str, Any]] | None = None,
    databases: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    compiled_queries = compiled_queries or {}
    return {
        "schemaVersion": 1,
        "source": {
            "type": "metabase",
            "url": base_url,
            "dashboardId": dashboard.get("id"),
        },
        "databases": databases or [],
        "dashboard": {
            "id": dashboard.get("id"),
            "name": dashboard.get("name"),
            "description": dashboard.get("description"),
            "collectionId": dashboard.get("collection_id"),
            "tabs": sorted(
                (_compact_tab(tab) for tab in (dashboard.get("tabs") or []) if isinstance(tab, dict)),
                key=lambda tab: (tab["position"], tab["id"]),
            ),
            "filters": dashboard.get("parameters") or [],
            "cards": [
                _compact_dashboard_card(card, compiled_queries)
                for card in (dashboard.get("dashcards") or [])
                if isinstance(card, dict)
            ],
        },
        "limitations": limitations or [],
    }


def _dashboard_database_ids(dashboard: dict[str, Any]) -> list[int]:
    questions = []
    for card in dashboard.get("dashcards") or []:
        if not isinstance(card, dict):
            continue
        questions.append(card.get("card"))
        questions.extend(card.get("series") or [])
    return _question_database_ids(questions)


def _question_database_ids(questions: list[Any]) -> list[int]:
    return sorted(
        {
            database_id
            for question in questions
            if isinstance(question, dict)
            if isinstance((database_id := question.get("database_id")), int)
            and not isinstance(database_id, bool)
            and database_id > 0
        }
    )


def _compact_tab(tab: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": tab.get("id"),
        "name": tab.get("name"),
        "position": tab.get("position", 0),
    }


def _compact_dashboard_card(
    card: dict[str, Any],
    compiled_queries: dict[tuple[int, int], dict[str, Any]],
) -> dict[str, Any]:
    placement_id = card.get("id")
    question_id = card.get("card_id")
    compiled_query = (
        compiled_queries.get((placement_id, question_id))
        if isinstance(placement_id, int) and isinstance(question_id, int)
        else None
    )
    parameter_mappings = _compact_parameter_mappings(card, question_id)
    return {
        "placementId": placement_id,
        "questionId": question_id,
        "tabId": card.get("dashboard_tab_id"),
        "layout": {
            "row": card.get("row", 0),
            "column": card.get("col", 0),
            "width": card.get("size_x", 1),
            "height": card.get("size_y", 1),
        },
        "parameterMappings": parameter_mappings,
        "effectiveFilterIds": _effective_filter_ids(parameter_mappings),
        "visualizationSettings": card.get("visualization_settings") or {},
        "question": _compact_question(card.get("card"), compiled_query),
        "series": [
            _compact_series(card, series, compiled_queries)
            for series in (card.get("series") or [])
            if isinstance(series, dict)
        ],
    }


def _compact_series(
    card: dict[str, Any],
    series: dict[str, Any],
    compiled_queries: dict[tuple[int, int], dict[str, Any]],
) -> dict[str, Any]:
    placement_id = card.get("id")
    question_id = series.get("id")
    compiled_query = (
        compiled_queries.get((placement_id, question_id))
        if isinstance(placement_id, int) and isinstance(question_id, int)
        else None
    )
    parameter_mappings = _compact_parameter_mappings(card, question_id)
    return {
        "questionId": question_id,
        "parameterMappings": parameter_mappings,
        "effectiveFilterIds": _effective_filter_ids(parameter_mappings),
        "question": _compact_question(series, compiled_query),
    }


def _compact_parameter_mappings(card: dict[str, Any], question_id: Any) -> list[dict[str, Any]]:
    mappings = card.get("parameter_mappings")
    if not isinstance(mappings, list):
        return []
    return [
        {
            "parameterId": mapping.get("parameter_id"),
            "questionId": mapping.get("card_id"),
            "target": mapping.get("target"),
        }
        for mapping in mappings
        if isinstance(mapping, dict) and mapping.get("card_id") == question_id
    ]


def _effective_filter_ids(parameter_mappings: list[dict[str, Any]]) -> list[str]:
    return list(
        dict.fromkeys(
            mapping["parameterId"] for mapping in parameter_mappings if isinstance(mapping.get("parameterId"), str)
        )
    )


def _compact_question(
    question: Any,
    compiled_query: dict[str, Any] | None,
) -> dict[str, Any] | None:
    if not isinstance(question, dict) or not question.get("id"):
        return None

    dataset_query = question.get("dataset_query")
    native_sql = _extract_native_sql(dataset_query)
    compiled_query = compiled_query or {}
    return {
        "id": question.get("id"),
        "name": question.get("name"),
        "description": question.get("description"),
        "display": question.get("display"),
        "type": question.get("type"),
        "databaseId": question.get("database_id"),
        "datasetQuery": dataset_query,
        "mbql": dataset_query if native_sql is None else None,
        "nativeSql": native_sql,
        "sql": compiled_query.get("sql") or native_sql,
        "sqlParameters": compiled_query.get("parameters") or [],
        "visualizationSettings": question.get("visualization_settings") or {},
        "resultMetadata": question.get("result_metadata") or [],
    }


def _extract_native_sql(dataset_query: Any) -> str | None:
    if not isinstance(dataset_query, dict):
        return None

    native = dataset_query.get("native")
    if isinstance(native, dict) and isinstance(native.get("query"), str):
        return native["query"]

    stages = dataset_query.get("stages")
    if isinstance(stages, list):
        return next(
            (stage["native"] for stage in stages if isinstance(stage, dict) and isinstance(stage.get("native"), str)),
            None,
        )
    return None


def _write_manifest(output: Path, serialized: str) -> None:
    destination = output.expanduser()
    if destination.suffix.lower() != ".json":
        raise MetabaseCliError("Output file must use the .json extension.")
    destination.parent.mkdir(parents=True, exist_ok=True)
    try:
        with destination.open("x") as file:
            file.write(serialized)
    except FileExistsError as error:
        raise MetabaseCliError(f"Output file already exists: {destination}") from error
    except OSError as error:
        raise MetabaseCliError(f"Could not write output file {destination}: {error}") from error
    UI.success(f"Created Metabase import manifest: {destination}")
