import math
import re
from io import BytesIO
from pathlib import Path, PurePosixPath
from typing import cast
from xml.etree import ElementTree
from zipfile import ZipFile

MAX_DEFINITION_BYTES = 32 * 1024 * 1024
NON_WORKSHEET_ZONE_TYPES = {
    "color",
    "dashboard-object",
    "empty",
    "filter",
    "layout-basic",
    "layout-flow",
    "legend",
    "paramctrl",
    "text",
    "title",
    "web",
}


def parse_workbook(workbook: Path | bytes, dashboard_name: str | None = None) -> dict[str, object]:
    data = workbook.read_bytes() if isinstance(workbook, Path) else workbook
    xml_bytes = read_workbook_xml(data)
    if len(xml_bytes) > MAX_DEFINITION_BYTES:
        raise ValueError("The Tableau workbook definition exceeds the 32 MB parsing limit.")

    try:
        root = ElementTree.fromstring(xml_bytes)
    except ElementTree.ParseError as error:
        raise ValueError("The Tableau workbook contains invalid XML.") from error

    workbook_element = next((element for element in root.iter() if local_name(element) == "workbook"), None)
    if workbook_element is None:
        raise ValueError("This file does not contain a Tableau <workbook> definition.")

    worksheet_elements = section_children(workbook_element, "worksheets", "worksheet")
    worksheets = [name for worksheet in worksheet_elements if (name := attribute(worksheet, "name"))]
    worksheet_names = set(worksheets)
    dashboard_elements = section_children(workbook_element, "dashboards", "dashboard")
    all_dashboards = [parse_dashboard(dashboard, worksheet_names) for dashboard in dashboard_elements]
    dashboards = select_dashboards(all_dashboards, dashboard_name)
    selected_worksheets = {
        worksheet for dashboard in dashboards for worksheet in cast(list[str], dashboard["worksheets"])
    }
    placed_worksheets = {
        worksheet for dashboard in all_dashboards for worksheet in cast(list[str], dashboard["worksheets"])
    }

    return {
        "worksheets": worksheets,
        "worksheet_visualizations": [parse_worksheet_visualization(worksheet) for worksheet in worksheet_elements],
        "dashboards": dashboards,
        "skipped_worksheets": [
            name for name in worksheets if name not in (selected_worksheets if dashboard_name else placed_worksheets)
        ],
        "warnings": build_warnings(all_dashboards, worksheet_names),
    }


def select_dashboards(
    dashboards: list[dict[str, object]],
    requested: str | None,
) -> list[dict[str, object]]:
    if not requested:
        return dashboards

    match = next(
        (dashboard for dashboard in dashboards if normalize(str(dashboard["name"])) == normalize(requested)),
        None,
    )
    if not match:
        available = ", ".join(str(dashboard["name"]) for dashboard in dashboards) or "none"
        raise ValueError(f'No dashboard named "{requested}" was found. Available dashboards: {available}.')
    return [match]


def build_warnings(
    dashboards: list[dict[str, object]],
    worksheet_names: set[str],
) -> list[str]:
    warnings = [] if dashboards else ["The workbook contains no dashboards."]

    for dashboard in dashboards:
        dashboard_name = str(dashboard["name"])
        for zone in cast(list[dict[str, object]], dashboard["zones"]):
            zone_type_value = zone.get("type")
            zone_name = zone.get("name")
            if (
                zone_type_value in {"worksheet", "sheet"}
                and isinstance(zone_name, str)
                and zone_name not in worksheet_names
            ):
                warnings.append(f"{dashboard_name} references missing worksheet {zone_name}.")
            if zone.get("worksheet") and ("x" not in zone or "y" not in zone):
                warnings.append(
                    f"{dashboard_name} has incomplete worksheet coordinates; its layout_rows are approximate."
                )
    return warnings


def normalize(value: str) -> str:
    return re.sub(r"[\s_-]+", "", value.lower())


def read_workbook_xml(data: bytes) -> bytes:
    if data[:4] != b"PK\x03\x04":
        return data

    with ZipFile(BytesIO(data)) as archive:
        definitions = [
            entry
            for entry in archive.infolist()
            if entry.filename.lower().endswith(".twb")
            and "data" not in {part.lower() for part in PurePosixPath(entry.filename).parts}
            and entry.file_size <= MAX_DEFINITION_BYTES
        ]
        definitions.sort(key=lambda entry: (len(PurePosixPath(entry.filename).parts), entry.filename))
        if not definitions:
            raise ValueError("No .twb definition was found inside this .twbx archive.")
        return archive.read(definitions[0])


def parse_worksheet_visualization(
    worksheet: ElementTree.Element,
) -> dict[str, object]:
    rows = parse_shelf(worksheet, "rows")
    columns = parse_shelf(worksheet, "cols")
    encodings = parse_encodings(worksheet)
    mark_types = unique(
        [attribute(mark, "class") for mark in descendants_named(worksheet, "mark") if attribute(mark, "class")]
    )
    stacking = next(
        (
            attribute(element, "mode")
            for element in descendants_named(worksheet, "stacking")
            if attribute(element, "mode")
        ),
        None,
    )

    return compact(
        {
            "worksheet": attribute(worksheet, "name"),
            "source_chart_type": source_chart_type(
                mark_types,
                rows,
                columns,
                encodings,
            ),
            "mark_types": mark_types,
            "orientation": chart_orientation(mark_types, rows, columns),
            "stacking": stacking,
            "rows": rows,
            "columns": columns,
            "encodings": encodings,
            "colors": parse_color_encodings(worksheet),
            "formatting": parse_visual_formatting(worksheet),
        }
    )


def parse_shelf(
    worksheet: ElementTree.Element,
    shelf_name: str,
) -> list[dict[str, object]]:
    shelf = next(iter(descendants_named(worksheet, shelf_name)), None)
    if shelf is None:
        return []
    value = element_text(shelf)
    references = re.findall(r"(?:\[[^\]]+\]\.)?\[[^\]]+\]", value)
    return [parse_field_reference(reference) for reference in references]


def parse_encodings(worksheet: ElementTree.Element) -> list[dict[str, object]]:
    encodings: list[dict[str, object]] = []
    seen: set[tuple[str, str]] = set()

    for container in descendants_named(worksheet, "encodings"):
        for encoding in container:
            channel = local_name(encoding)
            field = attribute(encoding, "column") or attribute(encoding, "field")
            key = (channel, field)
            if not field or key in seen:
                continue
            seen.add(key)
            encodings.append(
                compact(
                    {
                        "channel": channel,
                        "field": field,
                        "caption": field_display_name(field),
                        "type": attribute(encoding, "type") or None,
                    }
                )
            )

    return encodings


def parse_color_encodings(
    worksheet: ElementTree.Element,
) -> list[dict[str, object]]:
    colors: list[dict[str, object]] = []

    for encoding in descendants_named(worksheet, "encoding"):
        if attribute(encoding, "attr").lower() != "color":
            continue
        field = attribute(encoding, "field")
        assignments = [
            compact(
                {
                    "value": clean_xml_value(attribute(mapping, "value")) or None,
                    "color": (attribute(mapping, "to") or attribute(mapping, "color") or None),
                }
            )
            for mapping in descendants_named(encoding, "map")
            if attribute(mapping, "to") or attribute(mapping, "color")
        ]
        colors.append(
            compact(
                {
                    "field": field or None,
                    "caption": field_display_name(field) if field else None,
                    "palette": (attribute(encoding, "palette") or attribute(encoding, "type") or None),
                    "assignments": assignments,
                }
            )
        )

    return colors


def parse_visual_formatting(
    worksheet: ElementTree.Element,
) -> list[dict[str, object]]:
    supported_attributes = {
        "color",
        "font-color",
        "font-size",
        "mark-labels-show",
        "text-format",
        "transparency",
    }
    formatting: list[dict[str, object]] = []

    for element in descendants_named(worksheet, "format"):
        name = attribute(element, "attr")
        value = attribute(element, "value")
        if name not in supported_attributes or not value:
            continue
        formatting.append(
            compact(
                {
                    "attribute": name,
                    "value": value,
                    "field": attribute(element, "field") or None,
                }
            )
        )

    return formatting


def parse_field_reference(value: str) -> dict[str, object]:
    parts = re.findall(r"\[([^\]]+)\]", value)
    encoded = parts[-1] if parts else value
    segments = encoded.split(":")
    return compact(
        {
            "field": value,
            "caption": field_display_name(value),
            "data_source": parts[0] if len(parts) > 1 else None,
            "aggregation": segments[0] if len(segments) >= 3 else None,
            "type": segments[-1] if len(segments) >= 3 else None,
        }
    )


def source_chart_type(
    mark_types: list[str],
    rows: list[dict[str, object]],
    columns: list[dict[str, object]],
    encodings: list[dict[str, object]],
) -> str:
    marks = {mark.lower() for mark in mark_types}
    channels = {str(encoding["channel"]) for encoding in encodings}
    fields = {field_display_name(str(entry["field"])).lower() for entry in [*rows, *columns]}

    if marks & {"map", "polygon"} or any("latitude" in field or "longitude" in field for field in fields):
        return "map"
    if "pie" in marks:
        return "pie"
    if "square" in marks and "size" in channels:
        return "treemap"
    if "line" in marks:
        return "line"
    if "area" in marks:
        return "area"
    if "bar" in marks:
        return "horizontal_bar" if chart_orientation(mark_types, rows, columns) == "horizontal" else "bar"
    if "circle" in marks and rows and columns:
        return "scatter"
    if marks & {"text", "automatic"} and "text" in channels:
        return "table"
    return next(iter(mark_types), "automatic").lower()


def chart_orientation(
    mark_types: list[str],
    rows: list[dict[str, object]],
    columns: list[dict[str, object]],
) -> str | None:
    if "bar" not in {mark.lower() for mark in mark_types}:
        return None
    row_aggregations = {str(field.get("aggregation", "")).lower() for field in rows}
    column_aggregations = {str(field.get("aggregation", "")).lower() for field in columns}
    quantitative = {
        "avg",
        "count",
        "cnt",
        "max",
        "median",
        "min",
        "sum",
    }
    if column_aggregations & quantitative and not row_aggregations & quantitative:
        return "horizontal"
    if row_aggregations & quantitative and not column_aggregations & quantitative:
        return "vertical"
    return None


def parse_dashboard(dashboard: ElementTree.Element, worksheet_names: set[str]) -> dict[str, object]:
    parents = {child: parent for parent in dashboard.iter() for child in parent}
    size = next(
        (
            element
            for element in dashboard.iter()
            if local_name(element) == "size" and closest_ancestor(element, "devicelayout", parents) is None
        ),
        None,
    )
    zone_nodes = [
        element
        for element in dashboard.iter()
        if local_name(element) == "zone" and closest_ancestor(element, "devicelayout", parents) is None
    ]
    ids = {zone: attribute(zone, "id") or f"zone-{index + 1}" for index, zone in enumerate(zone_nodes)}
    worksheet_zones = [zone for zone in zone_nodes if worksheet_name(zone, worksheet_names)]
    width = number_attribute(size, "width")
    height = number_attribute(size, "height")

    return compact(
        {
            "name": attribute(dashboard, "name"),
            "width": width if width is not None else number_attribute(size, "maxwidth"),
            "height": height if height is not None else number_attribute(size, "maxheight"),
            "background_color": format_value(dashboard, "background-color"),
            "worksheets": unique([worksheet_name(zone, worksheet_names) for zone in worksheet_zones]),
            "layout_rows": layout_rows(worksheet_zones, worksheet_names),
            "zones": [parse_zone(zone, worksheet_names, ids, parents) for zone in zone_nodes],
            "controls": [
                parse_control(zone, worksheet_names)
                for zone in zone_nodes
                if zone_type(zone) in {"filter", "paramctrl"}
            ],
        }
    )


def parse_zone(
    zone: ElementTree.Element,
    worksheet_names: set[str],
    ids: dict[ElementTree.Element, str],
    parents: dict[ElementTree.Element, ElementTree.Element],
) -> dict[str, object]:
    parent = closest_ancestor(zone, "zone", parents)
    parameter = attribute(zone, "param")
    flow_direction = {
        "horz": "horizontal",
        "vert": "vertical",
    }.get(parameter)

    return compact(
        {
            "id": ids[zone],
            "parent_id": ids.get(parent) if parent is not None else None,
            "type": zone_type(zone) or None,
            "name": attribute(zone, "name") or None,
            "worksheet": worksheet_name(zone, worksheet_names) or None,
            "x": number_attribute(zone, "x"),
            "y": number_attribute(zone, "y"),
            "width": number_attribute(zone, "w"),
            "height": number_attribute(zone, "h"),
            "flow_direction": flow_direction,
            "floating": boolean_attribute(zone, "fixed-item"),
            "background_color": format_value(zone, "background-color"),
            "border_color": format_value(zone, "border-color"),
            "border_style": format_value(zone, "border-style"),
        }
    )


def parse_control(
    zone: ElementTree.Element,
    worksheet_names: set[str],
) -> dict[str, object]:
    name = attribute(zone, "name")
    return compact(
        {
            "type": "filter" if zone_type(zone) == "filter" else "parameter",
            "field": attribute(zone, "param") or None,
            "worksheet": name if name in worksheet_names else None,
        }
    )


def worksheet_name(zone: ElementTree.Element, worksheet_names: set[str]) -> str:
    name = attribute(zone, "name")
    if not name or name not in worksheet_names or zone_type(zone) in NON_WORKSHEET_ZONE_TYPES:
        return ""
    return name


def zone_type(zone: ElementTree.Element) -> str:
    return (attribute(zone, "type-v2") or attribute(zone, "type")).lower()


def layout_rows(
    zones: list[ElementTree.Element],
    worksheet_names: set[str],
) -> list[list[str]]:
    positioned: list[tuple[str, int | float, int | float | None, int]] = []
    for index, zone in enumerate(zones):
        x = number_attribute(zone, "x")
        positioned.append(
            (
                worksheet_name(zone, worksheet_names),
                x if x is not None else index,
                number_attribute(zone, "y"),
                index,
            )
        )

    positioned.sort(
        key=lambda zone: (
            zone[2] if zone[2] is not None else zone[3],
            zone[1],
        )
    )

    rows: dict[str, list[tuple[str, int | float, int | float | None, int]]] = {}
    for zone in positioned:
        key = f"unknown-{zone[3]}" if zone[2] is None else str(zone[2])
        rows.setdefault(key, []).append(zone)

    return [[zone[0] for zone in sorted(row, key=lambda zone: zone[1])] for row in rows.values()]


def descendants_named(
    root: ElementTree.Element,
    name: str,
) -> list[ElementTree.Element]:
    return [element for element in root.iter() if element is not root and local_name(element) == name]


def format_value(
    root: ElementTree.Element,
    name: str,
) -> str | None:
    return next(
        (
            attribute(element, "value")
            for element in descendants_named(root, "format")
            if attribute(element, "attr") == name and attribute(element, "value")
        ),
        None,
    )


def element_text(element: ElementTree.Element | None) -> str:
    if element is None:
        return ""
    return " ".join(text.strip() for text in element.itertext() if text.strip())


def field_display_name(value: str) -> str:
    parts = re.findall(r"\[([^\]]+)\]", value)
    raw = parts[-1] if parts else value
    segments = raw.split(":")
    return (":".join(segments[1:-1]) if len(segments) >= 3 else raw).strip()


def clean_xml_value(value: str) -> str:
    return re.sub(r'^"(.*)"$', r"\1", value).strip()


def section_children(
    root: ElementTree.Element,
    section_name: str,
    child_name: str,
) -> list[ElementTree.Element]:
    section = next((child for child in root if local_name(child) == section_name), None)
    if section is None:
        return []
    return [child for child in section if local_name(child) == child_name]


def local_name(element: ElementTree.Element) -> str:
    return element.tag.rsplit("}", 1)[-1].rsplit(":", 1)[-1].lower()


def attribute(element: ElementTree.Element | None, name: str) -> str:
    return element.attrib.get(name, "").strip() if element is not None else ""


def number_attribute(
    element: ElementTree.Element | None,
    name: str,
) -> int | float | None:
    value = attribute(element, name)
    if not value:
        return None

    try:
        number = float(value)
    except ValueError:
        return None
    if not math.isfinite(number):
        return None
    return int(number) if number.is_integer() else number


def boolean_attribute(
    element: ElementTree.Element | None,
    name: str,
) -> bool | None:
    value = attribute(element, name).lower()
    return value in {"1", "true", "yes"} if value else None


def closest_ancestor(
    element: ElementTree.Element,
    name: str,
    parents: dict[ElementTree.Element, ElementTree.Element],
) -> ElementTree.Element | None:
    parent = parents.get(element)
    while parent is not None:
        if local_name(parent) == name:
            return parent
        parent = parents.get(parent)
    return None


def unique(values: list[str]) -> list[str]:
    return list(dict.fromkeys(values))


def compact(value: dict[str, object | None]) -> dict[str, object]:
    return {key: entry for key, entry in value.items() if entry is not None}
