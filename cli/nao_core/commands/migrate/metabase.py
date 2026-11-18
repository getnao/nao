import json
import os
import re
from collections import deque
from dataclasses import dataclass
from pathlib import Path
from tempfile import NamedTemporaryFile
from typing import Annotated, Any, Callable
from urllib.parse import ParseResult, urlparse, urlunparse

import yaml
from cyclopts import App, Parameter
from pydantic import SecretStr

from nao_core.commands.migrate.metabase_client import MetabaseClient
from nao_core.commands.migrate.metabase_client import MetabaseError as MetabaseCliError
from nao_core.config import MetabaseConfig, NaoConfig, NaoConfigError
from nao_core.tracking import track_command
from nao_core.ui import UI, ask_text

metabase = App(name="metabase")
METABASE_TEMPLATE_SYNTAX_PATTERN = re.compile(r"\{\{[^{}]+\}\}|\[\[.*?\]\]", re.DOTALL)
BOUND_SQL_PARAMETERS_LIMITATION = (
    "Nao execute_sql does not support bound SQL parameters; translate supported native filters or skip this question."
)
QUERY_EXECUTION_REQUIRED_LIMITATION = (
    "Compiled SQL requires running this Metabase question; rerun with --allow-query-execution to allow it."
)
INACCESSIBLE_CARD_LIMITATION = "Metabase did not return this card; it may be inaccessible or deleted."


@Parameter(name="*")
@dataclass
class ExportOptions:
    parameters: Annotated[
        list[str] | None,
        Parameter(
            name="--parameter",
            help='Set a Metabase parameter as ID=JSON, for example period="2026-09-01".',
        ),
    ] = None
    allow_query_execution: Annotated[
        bool,
        Parameter(
            name="--allow-query-execution",
            help="Allow Metabase to run saved questions when compiled SQL is required.",
        ),
    ] = False
    json_output: Annotated[
        bool,
        Parameter(name="--json", help="Print compact JSON for machine consumption."),
    ] = False
    output: Annotated[
        Path | None,
        Parameter(name=["-o", "--output"], help="Write the import manifest to this file."),
    ] = None


@dataclass(frozen=True)
class ExportSelection:
    resource: str
    details: dict[str, Any]
    failure_sources: list[str]


@metabase.command
def configure() -> None:
    """Save Metabase import credentials in nao_config.yaml."""
    try:
        config = _load_nao_config()
    except MetabaseCliError as error:
        UI.error(str(error))
        raise SystemExit(1)

    metabase_url = ask_text(
        "Metabase URL:",
        default=config.metabase.url if config.metabase else "",
        required_field=True,
    )
    api_key = ask_text("Metabase API key:", password=True, required_field=True)
    assert metabase_url is not None and api_key is not None

    try:
        metabase_url = _normalize_metabase_url(metabase_url)
        _save_metabase_config(MetabaseConfig(url=metabase_url, api_key=SecretStr(api_key)))
    except (MetabaseCliError, OSError) as error:
        UI.error(str(error))
        raise SystemExit(1)

    UI.success(f"Saved Metabase credentials to {Path.cwd() / 'nao_config.yaml'}")


@metabase.command
@track_command("migrate metabase dashboard")
def dashboard(
    sources: Annotated[list[str], Parameter(help="Numeric Metabase dashboard IDs or URLs.")],
    /,
    *,
    options: ExportOptions | None = None,
) -> None:
    """Export one or more Metabase dashboards as nao import manifests."""
    _run_source_exports("dashboard", sources, export_dashboard, options or ExportOptions())


@metabase.command
@track_command("migrate metabase question")
def question(
    sources: Annotated[list[str], Parameter(help="Numeric Metabase question IDs or URLs.")],
    /,
    *,
    options: ExportOptions | None = None,
) -> None:
    """Export one or more Metabase questions as nao import manifests."""
    _run_source_exports("question", sources, export_question, options or ExportOptions())


@metabase.command
@track_command("migrate metabase collection")
def collection(
    source: Annotated[str, Parameter(help="Numeric Metabase collection ID or URL.")],
    *,
    recursive: Annotated[
        bool,
        Parameter(help="Include dashboards from nested collections."),
    ] = False,
    options: ExportOptions | None = None,
) -> None:
    """Export dashboards from a Metabase collection."""
    options = options or ExportOptions()
    selection = ExportSelection(
        resource="dashboard",
        details={"mode": "collection", "source": source, "recursive": recursive},
        failure_sources=[source],
    )
    _run_export(
        selection,
        lambda parameter_values, consumed_parameter_ids, allow_query_execution: _export_collection(
            source,
            recursive,
            parameter_values,
            consumed_parameter_ids,
            allow_query_execution,
        ),
        options,
    )


def _run_source_exports(
    resource: str,
    sources: list[str],
    exporter: Callable[[str, dict[str, Any], set[str] | None, bool], dict[str, Any]],
    options: ExportOptions,
) -> None:
    if not sources:
        UI.error(f"At least one Metabase {resource} ID or URL is required.")
        raise SystemExit(1)

    unique_sources = list(dict.fromkeys(sources))
    selection = ExportSelection(
        resource=resource,
        details={"mode": "explicit", "sources": sources},
        failure_sources=unique_sources,
    )
    _run_export(
        selection,
        lambda parameter_values, consumed_parameter_ids, allow_query_execution: _collect_exports(
            sources,
            lambda source: exporter(
                source,
                parameter_values,
                consumed_parameter_ids,
                allow_query_execution,
            ),
        ),
        options,
    )


def _run_export(
    selection: ExportSelection,
    exporter_factory: Callable[
        [dict[str, Any], set[str], bool],
        tuple[list[dict[str, Any]], list[dict[str, str]]],
    ],
    options: ExportOptions,
) -> None:
    manifests: list[dict[str, Any]] = []
    errors: list[dict[str, str]] = []
    try:
        parameter_values = _parse_parameter_values(options.parameters)
        consumed_parameter_ids: set[str] = set()
        manifests, errors = exporter_factory(
            parameter_values,
            consumed_parameter_ids,
            options.allow_query_execution,
        )
    except MetabaseCliError as error:
        if not options.json_output and options.output is None:
            UI.error(str(error))
            raise SystemExit(1)
        errors = [{"source": source, "reason": str(error)} for source in selection.failure_sources]
    else:
        try:
            _reject_unmatched_parameter_values(parameter_values, consumed_parameter_ids)
        except MetabaseCliError as error:
            if not options.json_output and options.output is None:
                UI.error(str(error))
                raise SystemExit(1)
            errors.append({"source": "parameters", "reason": str(error)})

    try:
        _emit_manifest(
            _build_batch_manifest(selection.resource, manifests, errors, selection.details),
            options.json_output,
            options.output,
        )
    except MetabaseCliError as error:
        if options.json_output:
            print(
                json.dumps(
                    {"success": False, "error": str(error)},
                    ensure_ascii=False,
                    separators=(",", ":"),
                )
            )
        else:
            UI.error(str(error))
        raise SystemExit(1)
    if errors:
        raise SystemExit(1)


def _export_collection(
    source: str,
    recursive: bool,
    parameter_values: dict[str, Any],
    consumed_parameter_ids: set[str],
    allow_query_execution: bool,
) -> tuple[list[dict[str, Any]], list[dict[str, str]]]:
    base_url, collection_id = _resolve_collection_source(source)
    with _metabase_client(base_url, "collection") as client:
        dashboard_ids = _collection_dashboard_ids(client, collection_id, recursive)
        return _collect_exports(
            [str(dashboard_id) for dashboard_id in dashboard_ids],
            lambda dashboard_id: _export_dashboard(
                client,
                base_url,
                int(dashboard_id),
                parameter_values,
                consumed_parameter_ids,
                allow_query_execution,
            ),
        )


def _load_nao_config() -> NaoConfig:
    try:
        config = NaoConfig.try_load(Path.cwd(), raise_on_error=True)
    except NaoConfigError as error:
        raise MetabaseCliError(str(error)) from error
    assert config is not None
    return config


def _save_metabase_config(metabase_config: MetabaseConfig) -> None:
    config_path = Path.cwd() / "nao_config.yaml"
    data = yaml.safe_load(config_path.read_text())
    if not isinstance(data, dict):
        raise MetabaseCliError("nao_config.yaml must contain a YAML object.")
    serialized_config = metabase_config.model_dump(mode="json")
    serialized_config["api_key"] = metabase_config.api_key.get_secret_value()
    data["metabase"] = serialized_config
    config_path.write_text(yaml.safe_dump(data, sort_keys=False, allow_unicode=True))


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
    errors: list[dict[str, str]] = []
    for source in dict.fromkeys(sources):
        try:
            manifests.append(exporter(source))
        except MetabaseCliError as error:
            errors.append({"source": source, "reason": str(error)})
    return manifests, errors


def _build_batch_manifest(
    resource: str,
    manifests: list[dict[str, Any]],
    errors: list[dict[str, str]],
    selection: dict[str, Any],
) -> dict[str, Any]:
    selected = len(manifests) + len(errors)
    manifest = {
        "version": 1,
        "type": "metabase-batch",
        "resource": resource,
        "selection": selection,
        "items": manifests,
        "errors": errors,
    }
    if selected > 1:
        manifest["summary"] = {
            "total": selected,
            "success": len(manifests),
            "errors": len(errors),
        }
    return manifest


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
    allow_query_execution: bool = False,
) -> dict[str, Any]:
    base_url, dashboard_id = _resolve_dashboard_source(source)
    with _metabase_client(base_url, "dashboard") as client:
        return _export_dashboard(
            client,
            base_url,
            dashboard_id,
            parameter_values,
            batch_consumed_parameter_ids,
            allow_query_execution,
        )


def _export_dashboard(
    client: MetabaseClient,
    base_url: str,
    dashboard_id: int,
    parameter_values: dict[str, Any] | None = None,
    batch_consumed_parameter_ids: set[str] | None = None,
    allow_query_execution: bool = False,
) -> dict[str, Any]:
    dashboard_data = _fetch_dashboard(client, dashboard_id)
    compiled_queries, limitations = _compile_queries(
        client,
        dashboard_id,
        dashboard_data,
        parameter_values,
        batch_consumed_parameter_ids,
        allow_query_execution,
    )
    limitations = _inaccessible_card_limitations(dashboard_data) + limitations
    databases, database_limitations = _fetch_database_metadata(
        client,
        _dashboard_database_ids(dashboard_data),
    )
    return _build_dashboard_manifest(
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
    allow_query_execution: bool = False,
) -> dict[str, Any]:
    base_url, question_id = _resolve_question_source(source)
    with _metabase_client(base_url, "question") as client:
        question_data = _fetch_question(client, question_id)
        values = parameter_values or {}
        query_parameters, consumed_parameter_ids = _question_query_parameters(question_data, values)
        if batch_consumed_parameter_ids is None:
            _reject_unmatched_parameter_values(values, consumed_parameter_ids)
        else:
            batch_consumed_parameter_ids.update(consumed_parameter_ids)
        compiled_query: dict[str, Any] | None = None
        limitations: list[dict[str, Any]] = []
        if _requires_question_compilation(question_data, query_parameters):
            if not allow_query_execution:
                limitations.append(_question_limitation(question_data, QUERY_EXECUTION_REQUIRED_LIMITATION))
            else:
                try:
                    compiled_query = _compile_question(
                        client,
                        None,
                        question_id,
                        query_parameters,
                    )
                    if compiled_query["parameters"]:
                        limitations.append(_question_limitation(question_data, BOUND_SQL_PARAMETERS_LIMITATION))
                except MetabaseCliError as error:
                    limitations.append(_question_limitation(question_data, str(error)))
        databases, database_limitations = _fetch_database_metadata(
            client,
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
    if resource_url is None or _url_origin(resource_url) is None:
        raise MetabaseCliError(f"{name} must be a positive numeric ID or a Metabase {resource} URL.")

    base_url = _configured_metabase_url(resource)
    configured_url = urlparse(base_url)
    if _url_origin(resource_url) != _url_origin(configured_url):
        UI.warn(f"{name} URL uses a different server; reading it from the Metabase configured in nao_config.yaml.")
    match = re.search(rf"/{re.escape(resource)}/([1-9]\d*)(?:[-/]|$)", resource_url.path)
    if not match:
        raise MetabaseCliError(f"{name} URL does not contain a valid Metabase {resource} ID.")
    return base_url, int(match.group(1))


def _configured_metabase_url(resource: str = "resource") -> str:
    return _normalize_metabase_url(_configured_metabase(resource).url)


def _normalize_metabase_url(base_url: str) -> str:
    try:
        url = urlparse(base_url)
    except ValueError:
        url = None
    if url is None or _url_origin(url) is None:
        raise MetabaseCliError("Metabase URL must be a valid HTTP(S) URL.")
    return urlunparse((url.scheme, url.netloc, url.path.rstrip("/"), "", "", ""))


def _url_origin(url: ParseResult) -> tuple[str, str, int] | None:
    if url.scheme not in {"http", "https"} or not url.hostname:
        return None
    try:
        port = url.port
    except ValueError:
        return None
    return url.scheme, url.hostname.lower(), port or (443 if url.scheme == "https" else 80)


def _fetch_dashboard(client: MetabaseClient, dashboard_id: int) -> dict[str, Any]:
    dashboard = client.fetch_dashboard(dashboard_id)
    _validate_dashboard_response(dashboard, dashboard_id)
    return dashboard


def _fetch_question(client: MetabaseClient, question_id: int) -> dict[str, Any]:
    question = client.fetch_question(question_id)
    _validate_question_response(question, question_id)
    return question


def _validate_dashboard_response(dashboard: dict[str, Any], dashboard_id: int) -> None:
    if not _is_positive_int(dashboard.get("id")) or dashboard.get("id") != dashboard_id:
        raise MetabaseCliError("Metabase returned an unexpected dashboard response.")
    for field in ("dashcards", "tabs", "parameters"):
        value = dashboard.get(field)
        if (field == "dashcards" and not isinstance(value, list)) or (
            value is not None and (not isinstance(value, list) or not all(isinstance(item, dict) for item in value))
        ):
            raise MetabaseCliError("Metabase returned an unexpected dashboard response.")
    for card in dashboard["dashcards"]:
        card_id = card.get("card_id")
        if card_id is None:
            continue
        if not _is_positive_int(card_id) or "card" not in card:
            raise MetabaseCliError("Metabase returned an unexpected dashboard response.")
        question = card["card"]
        if question is not None:
            if not isinstance(question, dict):
                raise MetabaseCliError("Metabase returned an unexpected dashboard response.")
            _validate_question_response(question, card_id)
        series = card.get("series")
        if series is not None:
            if not isinstance(series, list) or not all(isinstance(item, dict) for item in series):
                raise MetabaseCliError("Metabase returned an unexpected dashboard response.")
            for question in series:
                _validate_question_response(question, question.get("id"))


def _validate_question_response(question: dict[str, Any], question_id: Any) -> None:
    if (
        not _is_positive_int(question_id)
        or not _is_positive_int(question.get("id"))
        or question.get("id") != question_id
    ):
        raise MetabaseCliError("Metabase returned an unexpected question response.")
    if not isinstance(question.get("dataset_query"), dict):
        raise MetabaseCliError("Metabase returned an unexpected question response.")
    expected_fields = {"visualization_settings": dict, "result_metadata": list}
    for field, expected_type in expected_fields.items():
        value = question.get(field)
        if value is not None and not isinstance(value, expected_type):
            raise MetabaseCliError("Metabase returned an unexpected question response.")


def _is_positive_int(value: Any) -> bool:
    return isinstance(value, int) and not isinstance(value, bool) and value > 0


def _fetch_database_metadata(
    client: MetabaseClient,
    database_ids: list[int],
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    databases: list[dict[str, Any]] = []
    limitations: list[dict[str, Any]] = []
    for database_id in database_ids:
        try:
            data = client.fetch_database(database_id)
        except MetabaseCliError as error:
            limitations.append({"kind": "database", "database_id": database_id, "reason": str(error)})
            continue
        databases.append(
            {
                "id": database_id,
                "name": data.get("name"),
                "engine": data.get("engine"),
            }
        )
    return databases, limitations


def _collection_dashboard_ids(client: MetabaseClient, collection_id: int, recursive: bool) -> list[int]:
    pending = deque([collection_id])
    visited: set[int] = set()
    dashboard_ids: list[int] = []
    seen_dashboards: set[int] = set()

    while pending:
        current_collection_id = pending.popleft()
        if current_collection_id in visited:
            continue
        visited.add(current_collection_id)

        for item in client.fetch_collection_items(current_collection_id):
            item_id = item.get("id")
            if item.get("model") == "dashboard" and isinstance(item_id, int) and item_id not in seen_dashboards:
                dashboard_ids.append(item_id)
                seen_dashboards.add(item_id)
            elif recursive and item.get("model") == "collection" and isinstance(item_id, int):
                pending.append(item_id)

    return dashboard_ids


def _compile_queries(
    client: MetabaseClient,
    dashboard_id: int,
    dashboard: dict[str, Any],
    parameter_values: dict[str, Any] | None = None,
    batch_consumed_parameter_ids: set[str] | None = None,
    allow_query_execution: bool = False,
) -> tuple[dict[tuple[int, int], dict[str, Any]], list[dict[str, Any]]]:
    values = parameter_values or {}
    contexts: list[tuple[int, dict[str, Any], list[dict[str, Any]]]] = []
    consumed_parameter_ids: set[str] = set()
    for dashcard_id, question, parameter_mappings in _dashboard_question_contexts(dashboard):
        query_parameters, consumed_ids = _mapped_query_parameters(
            dashboard.get("parameters"),
            parameter_mappings,
            values,
        )
        contexts.append((dashcard_id, question, query_parameters))
        consumed_parameter_ids.update(consumed_ids)
    consumed_parameter_ids.update(_inaccessible_card_consumed_parameter_ids(dashboard, values))
    if batch_consumed_parameter_ids is None:
        _reject_unmatched_parameter_values(values, consumed_parameter_ids)
    else:
        batch_consumed_parameter_ids.update(consumed_parameter_ids)

    compiled_queries: dict[tuple[int, int], dict[str, Any]] = {}
    limitations: list[dict[str, Any]] = []
    for dashcard_id, question, query_parameters in contexts:
        question_id = question.get("id")
        if not isinstance(question_id, int) or not _requires_question_compilation(question, query_parameters):
            continue
        if not allow_query_execution:
            limitations.append(_question_limitation(question, QUERY_EXECUTION_REQUIRED_LIMITATION, dashcard_id))
            continue
        try:
            compiled_query = _compile_question(
                client,
                dashboard_id,
                question_id,
                query_parameters,
            )
            compiled_queries[(dashcard_id, question_id)] = compiled_query
            if compiled_query["parameters"]:
                limitations.append(_question_limitation(question, BOUND_SQL_PARAMETERS_LIMITATION, dashcard_id))
        except MetabaseCliError as error:
            limitations.append(_question_limitation(question, str(error), dashcard_id))
    return compiled_queries, limitations


def _question_limitation(
    question: dict[str, Any],
    reason: str,
    dashcard_id: int | None = None,
) -> dict[str, Any]:
    return {
        "kind": "question",
        **({"dashcard_id": dashcard_id} if dashcard_id is not None else {}),
        "question_id": question.get("id"),
        "question_name": question.get("name"),
        "reason": reason,
    }


def _inaccessible_card_limitations(dashboard: dict[str, Any]) -> list[dict[str, Any]]:
    return [
        {
            "kind": "question",
            "dashcard_id": card.get("id"),
            "question_id": card["card_id"],
            "question_name": None,
            "reason": INACCESSIBLE_CARD_LIMITATION,
        }
        for card in dashboard["dashcards"]
        if card.get("card_id") is not None and card.get("card") is None
    ]


def _requires_question_compilation(question: dict[str, Any], query_parameters: list[dict[str, Any]]) -> bool:
    native_sql = _extract_native_sql(question.get("dataset_query"))
    return bool(query_parameters) or native_sql is None or _contains_metabase_template_syntax(native_sql)


def _dashboard_question_contexts(
    dashboard: dict[str, Any],
) -> list[tuple[int, dict[str, Any], list[dict[str, Any]]]]:
    contexts: list[tuple[int, dict[str, Any], list[dict[str, Any]]]] = []
    for card in dashboard.get("dashcards") or []:
        if not isinstance(card, dict) or not isinstance(card.get("id"), int):
            continue
        dashcard_id = card["id"]
        if isinstance(card.get("card"), dict):
            question = card["card"]
            contexts.append((dashcard_id, question, _parameter_mappings_for_question(card, question.get("id"))))
        contexts.extend(
            (dashcard_id, series, _parameter_mappings_for_question(card, series.get("id")))
            for series in (card.get("series") or [])
            if isinstance(series, dict)
        )
    return contexts


def _inaccessible_card_consumed_parameter_ids(dashboard: dict[str, Any], values: dict[str, Any]) -> set[str]:
    consumed_parameter_ids: set[str] = set()
    for card in dashboard.get("dashcards") or []:
        if not isinstance(card, dict) or card.get("card") is not None or not isinstance(card.get("card_id"), int):
            continue
        _, consumed_ids = _mapped_query_parameters(
            dashboard.get("parameters"),
            _parameter_mappings_for_question(card, card["card_id"]),
            values,
        )
        consumed_parameter_ids.update(consumed_ids)
    return consumed_parameter_ids


def _compile_question(
    client: MetabaseClient,
    dashboard_id: int | None,
    question_id: int,
    parameters: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    result = client.compile_question(question_id, dashboard_id, parameters)
    compiled_query = _extract_compiled_query(result)
    if compiled_query is None or _contains_metabase_template_syntax(compiled_query["sql"]):
        raise MetabaseCliError("Metabase did not return executable compiled SQL for this question.")
    return compiled_query


def _metabase_client(base_url: str, resource: str) -> MetabaseClient:
    return MetabaseClient(base_url, _configured_metabase_api_key(resource))


def _configured_metabase_api_key(resource: str) -> str:
    return _configured_metabase(resource).api_key.get_secret_value()


def _configured_metabase(resource: str) -> MetabaseConfig:
    config = _load_nao_config()
    if config.metabase is None:
        raise MetabaseCliError(
            f"Metabase configuration is required to read a Metabase {resource}. "
            "Run 'nao migrate metabase configure' in your terminal."
        )
    return config.metabase


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
        "version": 1,
        "source": {
            "type": "metabase",
            "url": base_url,
            "question_id": question.get("id"),
        },
        "databases": databases or [],
        "question": _compact_question(question, compiled_query),
        "limitations": limitations or [],
    }


def _build_dashboard_manifest(
    base_url: str,
    dashboard: dict[str, Any],
    compiled_queries: dict[tuple[int, int], dict[str, Any]] | None = None,
    limitations: list[dict[str, Any]] | None = None,
    databases: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    compiled_queries = compiled_queries or {}
    return {
        "version": 1,
        "source": {
            "type": "metabase",
            "url": base_url,
            "dashboard_id": dashboard.get("id"),
        },
        "databases": databases or [],
        "dashboard": {
            "id": dashboard.get("id"),
            "name": dashboard.get("name"),
            "description": dashboard.get("description"),
            "collection_id": dashboard.get("collection_id"),
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
    dashcard_id = card.get("id")
    question_id = card.get("card_id")
    compiled_query = (
        compiled_queries.get((dashcard_id, question_id))
        if isinstance(dashcard_id, int) and isinstance(question_id, int)
        else None
    )
    parameter_mappings = _compact_parameter_mappings(card, question_id)
    return {
        "dashcard_id": dashcard_id,
        "question_id": question_id,
        "tab_id": card.get("dashboard_tab_id"),
        "layout": {
            "row": card.get("row", 0),
            "column": card.get("col", 0),
            "width": card.get("size_x", 1),
            "height": card.get("size_y", 1),
        },
        "parameter_mappings": parameter_mappings,
        "effective_filter_ids": _effective_filter_ids(parameter_mappings),
        "visualization_settings": card.get("visualization_settings") or {},
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
    dashcard_id = card.get("id")
    question_id = series.get("id")
    compiled_query = (
        compiled_queries.get((dashcard_id, question_id))
        if isinstance(dashcard_id, int) and isinstance(question_id, int)
        else None
    )
    parameter_mappings = _compact_parameter_mappings(card, question_id)
    return {
        "question_id": question_id,
        "parameter_mappings": parameter_mappings,
        "effective_filter_ids": _effective_filter_ids(parameter_mappings),
        "question": _compact_question(series, compiled_query),
    }


def _compact_parameter_mappings(card: dict[str, Any], question_id: Any) -> list[dict[str, Any]]:
    mappings = card.get("parameter_mappings")
    if not isinstance(mappings, list):
        return []
    return [
        {
            "parameter_id": mapping.get("parameter_id"),
            "question_id": mapping.get("card_id"),
            "target": mapping.get("target"),
        }
        for mapping in mappings
        if isinstance(mapping, dict) and mapping.get("card_id") == question_id
    ]


def _effective_filter_ids(parameter_mappings: list[dict[str, Any]]) -> list[str]:
    return list(
        dict.fromkeys(
            mapping["parameter_id"] for mapping in parameter_mappings if isinstance(mapping.get("parameter_id"), str)
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
    sql_parameters = (compiled_query.get("parameters") or []) if compiled_query else []
    executable_sql = native_sql if compiled_query is None else compiled_query.get("sql")
    if sql_parameters:
        executable_sql = None
    if _contains_metabase_template_syntax(executable_sql):
        executable_sql = None
    return {
        "id": question.get("id"),
        "name": question.get("name"),
        "description": question.get("description"),
        "display": question.get("display"),
        "type": question.get("type"),
        "database_id": question.get("database_id"),
        "dataset_query": dataset_query,
        "mbql": dataset_query if native_sql is None else None,
        "native_sql": native_sql,
        "sql": executable_sql,
        "sql_parameters": sql_parameters,
        "visualization_settings": question.get("visualization_settings") or {},
        "result_metadata": question.get("result_metadata") or [],
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


def _contains_metabase_template_syntax(sql: Any) -> bool:
    return isinstance(sql, str) and METABASE_TEMPLATE_SYNTAX_PATTERN.search(sql) is not None


def _write_manifest(output: Path, serialized: str) -> None:
    destination = output.expanduser()
    try:
        destination.parent.mkdir(parents=True, exist_ok=True)
    except OSError as error:
        raise MetabaseCliError(f"Could not write output file {destination}: {error}") from error
    temporary_path: Path | None = None
    try:
        with NamedTemporaryFile(
            "w",
            encoding="utf-8",
            dir=destination.parent,
            prefix=f".{destination.name}.",
            delete=False,
        ) as file:
            temporary_path = Path(file.name)
            file.write(serialized)
            file.flush()
            os.fsync(file.fileno())
        os.replace(temporary_path, destination)
    except OSError as error:
        raise MetabaseCliError(f"Could not write output file {destination}: {error}") from error
    finally:
        if temporary_path is not None:
            temporary_path.unlink(missing_ok=True)
    UI.success(f"Wrote Metabase import manifest: {destination}")
