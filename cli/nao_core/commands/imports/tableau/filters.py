import re
from pathlib import Path
from typing import cast
from xml.etree import ElementTree

from nao_core.commands.imports.tableau.workbook import (
    MAX_DEFINITION_BYTES,
    attribute,
    compact,
    local_name,
    normalize,
    parse_workbook,
    read_workbook_xml,
    section_children,
    unique,
)

TRUE_VALUES = {"1", "true", "yes"}


def parse_filters(
    workbook: Path | bytes,
    worksheet_name: str | None = None,
    dashboard_name: str | None = None,
) -> dict[str, object]:
    if worksheet_name and dashboard_name:
        raise ValueError("Provide only one of worksheet or dashboard.")

    data = workbook.read_bytes() if isinstance(workbook, Path) else workbook
    xml_bytes = read_workbook_xml(data)
    if len(xml_bytes) > MAX_DEFINITION_BYTES:
        raise ValueError("The Tableau workbook definition exceeds the 32 MB parsing limit.")

    try:
        root = ElementTree.fromstring(xml_bytes)
    except ElementTree.ParseError as error:
        raise ValueError("The Tableau workbook contains invalid XML.") from error

    workbook_element = next(
        (element for element in root.iter() if local_name(element) == "workbook"),
        None,
    )
    if workbook_element is None:
        raise ValueError("This file does not contain a Tableau <workbook> definition.")

    worksheet_elements = section_children(
        workbook_element,
        "worksheets",
        "worksheet",
    )
    warnings: list[str] = []
    selected_worksheets = select_worksheet_names(
        worksheet_elements,
        xml_bytes,
        worksheet_name,
        dashboard_name,
    )
    filters = [
        filter_definition
        for worksheet in worksheet_elements
        if attribute(worksheet, "name") in selected_worksheets
        for filter_definition in extract_categorical_filters(worksheet, warnings)
    ]
    parameters = extract_parameters(
        root,
        worksheet_elements,
        selected_worksheets,
    )
    controls = (
        []
        if worksheet_name
        else extract_controls(
            xml_bytes,
            dashboard_name,
            filters,
            parameters,
            warnings,
        )
    )
    worksheet_mappings = extract_worksheet_mappings(controls)

    return {
        "filters": filters,
        "parameters": parameters,
        "controls": controls,
        "worksheet_mappings": worksheet_mappings,
        "warnings": unique(warnings),
    }


def select_worksheet_names(
    worksheets: list[ElementTree.Element],
    xml_bytes: bytes,
    requested_worksheet: str | None,
    requested_dashboard: str | None,
) -> set[str]:
    names = [name for worksheet in worksheets if (name := attribute(worksheet, "name"))]

    if requested_worksheet:
        match = next(
            (name for name in names if normalize(name) == normalize(requested_worksheet)),
            None,
        )
        if not match:
            available = ", ".join(names) or "none"
            raise ValueError(
                f'No worksheet named "{requested_worksheet}" was found. Available worksheets: {available}.'
            )
        return {match}

    if requested_dashboard:
        composition = parse_workbook(xml_bytes, requested_dashboard)
        dashboards = cast(list[dict[str, object]], composition["dashboards"])
        if not dashboards:
            return set()
        return set(cast(list[str], dashboards[0]["worksheets"]))

    return set(names)


def extract_categorical_filters(
    worksheet: ElementTree.Element,
    warnings: list[str],
) -> list[dict[str, object]]:
    worksheet_name = attribute(worksheet, "name")
    definitions: list[dict[str, object]] = []

    for filter_element in elements_named(worksheet, "filter"):
        field = attribute(filter_element, "column")
        filter_type = (attribute(filter_element, "class") or attribute(filter_element, "type")).lower()

        if not field:
            warnings.append(f"{worksheet_name} contains a filter without a field reference; it was skipped.")
            continue
        if filter_type != "categorical":
            warnings.append(f'{worksheet_name} filter {field} uses unsupported type "{filter_type}".')
            continue

        group_filters = elements_named(filter_element, "groupfilter")
        functions = [attribute(group_filter, "function").lower() for group_filter in group_filters]
        values = unique(
            [
                value
                for group_filter in group_filters
                if "member" in group_filter.attrib
                if (value := clean_value(attribute(group_filter, "member")))
            ]
        )
        if not values:
            warnings.append(f"{worksheet_name} categorical filter {field} has no explicit member values.")

        parts = bracketed_parts(field)
        definitions.append(
            compact(
                {
                    "field": field,
                    "caption": display_field_name(field),
                    "data_source": parts[0] if parts else None,
                    "filter_type": filter_type,
                    "context": any(
                        attribute(filter_element, name).lower() in TRUE_VALUES
                        for name in ("context", "is-context", "context-filter")
                    ),
                    "mode": ("exclude" if any(value in {"except", "exclude"} for value in functions) else "include"),
                    "values": values,
                    "target_worksheets": [worksheet_name],
                    "raw_expression": ElementTree.tostring(
                        filter_element,
                        encoding="unicode",
                    ),
                }
            )
        )

    return definitions


def extract_parameters(
    root: ElementTree.Element,
    all_worksheets: list[ElementTree.Element],
    selected_worksheets: set[str],
) -> list[dict[str, object]]:
    worksheets = [worksheet for worksheet in all_worksheets if attribute(worksheet, "name") in selected_worksheets]
    parameters: dict[str, dict[str, object]] = {}

    for column in elements_named(root, "column"):
        if "param-domain-type" not in column.attrib:
            continue

        field = attribute(column, "name")
        if not field:
            continue

        calculation = next(iter(elements_named(column, "calculation")), None)
        caption = attribute(column, "caption") or display_field_name(field)
        data_type = attribute(column, "datatype")
        current_value = clean_value(attribute(column, "value") or attribute(calculation, "formula"))
        allowed_values = [
            value
            for member in elements_named(column, "member")
            if "value" in member.attrib
            if (value := clean_value(attribute(member, "value")))
        ]
        target_worksheets = [
            attribute(worksheet, "name")
            for worksheet in worksheets
            if field in ElementTree.tostring(worksheet, encoding="unicode")
        ]
        key = normalize(field)
        existing = parameters.get(key, {})

        parameters[key] = compact(
            {
                "field": field,
                "caption": caption or None,
                "data_type": data_type or None,
                "current_value": current_value or None,
                "allowed_values": unique(
                    [
                        *cast(list[str], existing.get("allowed_values", [])),
                        *allowed_values,
                    ]
                ),
                "target_worksheets": unique(
                    [
                        *cast(list[str], existing.get("target_worksheets", [])),
                        *target_worksheets,
                    ]
                ),
            }
        )

    return list(parameters.values())


def extract_controls(
    xml_bytes: bytes,
    dashboard_name: str | None,
    filters: list[dict[str, object]],
    parameters: list[dict[str, object]],
    warnings: list[str],
) -> list[dict[str, object]]:
    composition = parse_workbook(xml_bytes, dashboard_name)
    dashboards = cast(list[dict[str, object]], composition["dashboards"])
    definitions: list[dict[str, object]] = []
    seen_ids: set[str] = set()

    for dashboard in dashboards:
        name = str(dashboard["name"])
        dashboard_worksheets = set(cast(list[str], dashboard["worksheets"]))

        for control in cast(list[dict[str, object]], dashboard["controls"]):
            control_type = control["type"]
            control_field = control.get("field")
            field = control_field if isinstance(control_field, str) else None
            source = control.get("worksheet")
            source_worksheet = source if isinstance(source, str) else None

            if control_type == "parameter":
                matches = [
                    candidate for candidate in parameters if field and fields_match(field, str(candidate["field"]))
                ]
                if len(matches) != 1:
                    warnings.append(
                        f"{name} parameter control {field or '(unknown field)'} does not match exactly one "
                        "parameter definition."
                    )
                    continue
                parameter = matches[0]

                target_worksheets = [
                    worksheet
                    for worksheet in cast(
                        list[str],
                        parameter["target_worksheets"],
                    )
                    if worksheet in dashboard_worksheets
                ]
                if not target_worksheets:
                    warnings.append(
                        f"{name} parameter control {field or str(parameter['field'])} "
                        "has no matching worksheet dependencies."
                    )

                identifier = control_identifier(
                    name,
                    str(parameter.get("caption") or parameter["field"]),
                )
                if identifier in seen_ids:
                    continue
                seen_ids.add(identifier)
                definitions.append(
                    compact(
                        {
                            "id": identifier,
                            "type": "parameter",
                            "dashboard": name,
                            "caption": parameter.get("caption"),
                            "field": field or str(parameter["field"]),
                            "source_worksheet": source_worksheet,
                            "target_worksheets": target_worksheets,
                            "current_value": parameter.get("current_value"),
                            "allowed_values": parameter.get("allowed_values"),
                            "mappings": [
                                compact(
                                    {
                                        "worksheet": worksheet,
                                        "source_field": str(parameter["field"]),
                                        "data_source": field_data_source(str(parameter["field"])),
                                    }
                                )
                                for worksheet in target_worksheets
                            ],
                        }
                    )
                )
                continue

            if not field:
                warnings.append(f"{name} contains a filter control without a field reference.")
                continue
            matches = [
                filter_definition
                for filter_definition in filters
                if fields_match(field, str(filter_definition["field"]))
                and any(
                    worksheet in dashboard_worksheets
                    for worksheet in cast(
                        list[str],
                        filter_definition["target_worksheets"],
                    )
                )
            ]
            if not matches:
                warnings.append(
                    f"{name} filter control {field or '(unknown field)'} has no matching categorical filter."
                )
                continue

            modes = {str(match["mode"]) for match in matches}
            if len(modes) != 1:
                warnings.append(f"{name} filter control {field} has conflicting include and exclude behavior.")
                continue

            identifier = control_identifier(name, display_field_name(field))
            if identifier in seen_ids:
                continue
            seen_ids.add(identifier)
            mappings = [
                compact(
                    {
                        "worksheet": worksheet,
                        "source_field": str(match["field"]),
                        "data_source": match.get("data_source"),
                        "mode": match["mode"],
                        "context": match["context"],
                    }
                )
                for match in matches
                for worksheet in cast(
                    list[str],
                    match["target_worksheets"],
                )
                if worksheet in dashboard_worksheets
            ]
            definitions.append(
                compact(
                    {
                        "id": identifier,
                        "type": "filter",
                        "dashboard": name,
                        "caption": display_field_name(field),
                        "field": field,
                        "source_worksheet": source_worksheet,
                        "mode": next(iter(modes)),
                        "values": unique([value for match in matches for value in cast(list[str], match["values"])]),
                        "target_worksheets": unique([str(mapping["worksheet"]) for mapping in mappings]),
                        "mappings": mappings,
                    }
                )
            )

    return definitions


def extract_worksheet_mappings(
    controls: list[dict[str, object]],
) -> list[dict[str, object]]:
    contexts: dict[tuple[str, str], dict[str, object]] = {}

    for control in controls:
        dashboard = str(control["dashboard"])
        control_id = str(control["id"])
        control_type = str(control["type"])
        for mapping in cast(list[dict[str, object]], control.get("mappings", [])):
            worksheet = str(mapping["worksheet"])
            context = contexts.setdefault(
                (dashboard, worksheet),
                {
                    "dashboard": dashboard,
                    "worksheet": worksheet,
                    "effective_filter_ids": [],
                    "parameter_mappings": [],
                },
            )
            cast(list[str], context["effective_filter_ids"]).append(control_id)
            cast(list[dict[str, object]], context["parameter_mappings"]).append(
                {
                    "filter_id": control_id,
                    "type": control_type,
                    **mapping,
                }
            )

    return [
        {
            **context,
            "effective_filter_ids": unique(cast(list[str], context["effective_filter_ids"])),
        }
        for context in contexts.values()
    ]


def fields_match(left: str, right: str) -> bool:
    left_source = field_data_source(left)
    right_source = field_data_source(right)
    return normalize(display_field_name(left)) == normalize(display_field_name(right)) and (
        not left_source or not right_source or normalize(left_source) == normalize(right_source)
    )


def field_data_source(field: str) -> str | None:
    parts = bracketed_parts(field)
    return parts[0] if len(parts) > 1 else None


def control_identifier(dashboard: str, field: str) -> str:
    identifier = re.sub(
        r"[^a-z0-9]+",
        "_",
        f"{dashboard}_{display_field_name(field)}".lower(),
    ).strip("_")
    return identifier if identifier and not identifier[0].isdigit() else f"filter_{identifier}"


def elements_named(
    root: ElementTree.Element,
    name: str,
) -> list[ElementTree.Element]:
    return [element for element in root.iter() if element is not root and local_name(element) == name]


def bracketed_parts(value: str) -> list[str]:
    return [match for match in re.findall(r"\[([^\]]+)\]", value) if match]


def display_field_name(value: str) -> str:
    parts = bracketed_parts(value)
    raw = parts[-1] if parts else value
    segments = raw.split(":")
    return (":".join(segments[1:-1]) if len(segments) >= 3 else raw).strip()


def clean_value(value: str) -> str:
    return re.sub(r'^"(.*)"$', r"\1", value).strip()
