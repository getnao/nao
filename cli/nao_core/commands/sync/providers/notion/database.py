"""Exporting Notion databases as markdown tables.

Every page walks its own block tree to find the databases it holds, which duplicates the
traversal notion2md performs internally and is the dominant request cost on large pages. It
is deliberate: notion2md silently drops blocks it cannot convert, so its markers alone cannot
tell an absent database from a lost one.
"""

import re
from dataclasses import dataclass
from typing import Any, cast

# notion2md emits this marker for database blocks it cannot convert itself, indented by
# one tab per nesting level
CHILD_DATABASE_MARKER = "[//]: # (child_database is not supported)"
INDENTED_CHILD_DATABASE_MARKER = re.compile(rf"^[ \t]*{re.escape(CHILD_DATABASE_MARKER)}", re.MULTILINE)

PAGE_SIZE = 100
MAX_RENDERED_ROWS = 500
MAX_FETCHED_ROWS = 5000
MAX_ERROR_LENGTH = 200

# Views that present one row per entry. Anything else — a chart, form or dashboard —
# aggregates instead, so there is no row list to export and no column list to honour.
ROW_VIEW_TYPES = frozenset({"table", "board", "list", "gallery", "calendar", "timeline", "map"})

# Rows a data source scan never reached are worth retrieving one by one only in small numbers
MAX_INDIVIDUAL_LOOKUPS = 50

# Loops are bounded by pages rather than by items on purpose: a response reporting more
# results while returning none would never advance an item counter, and the sync would hang
# inside a worker thread with no output at all.
MAX_PAGES = MAX_FETCHED_ROWS // PAGE_SIZE + 1


class DatabaseExportError(Exception):
    """Raised when a database embedded in a page cannot be rendered as a table.

    This fails the whole page on purpose. Writing the page without its table would overwrite
    a good file with a degraded one, losing content that only Notion still holds.
    """


class ViewUnavailableError(Exception):
    """Raised when the rows a view selects cannot be resolved.

    Exporting every row instead would silently widen the export past what the view shows,
    which is the failure this module exists to prevent, so callers must fail rather than
    fall back.
    """


@dataclass
class ViewRows:
    """What a view selects: row ids in display order, and the columns it shows."""

    row_ids: list[str]
    total: int
    complete: bool
    columns: list[dict[str, Any]] | None
    data_source_id: str | None = None


@dataclass
class FetchedRows:
    """Rows read from a database's data sources, keyed by page id."""

    rows: dict[str, dict[str, Any]]
    exhausted: bool


@dataclass
class DatabaseRows:
    """Database rows, with what is known about how many exist beyond them."""

    rows: list[dict[str, Any]]
    total: int | None
    complete: bool
    columns: list[str] | None = None
    unmatched: int = 0
    unmatched_columns: list[str] | None = None


def get_database_as_markdown(
    client: Any,
    database_id: str,
    view_id: str | None = None,
    *,
    use_default_view: bool = False,
) -> tuple[str, str]:
    """Fetch a Notion database and render its rows as a markdown table.

    When a view is targeted, Notion applies its saved filters and sorts so the export matches
    what a reader sees. Without one, every row is exported.

    Returns:
        Tuple of (title, markdown_table)
    """
    database = cast(dict[str, Any], client.databases.retrieve(database_id=database_id))
    title = join_rich_text(database.get("title", [])) or database_id

    if view_id is None and use_default_view:
        view_id = find_default_view_id(client, database_id)

    return title, render_table(fetch_rows(client, database, view_id))


def inject_child_databases(client: Any, page_id: str, markdown: str) -> str:
    """Replace notion2md's unsupported-database markers with real markdown tables.

    Markers carry no database id, so they are matched to databases by position. notion2md
    silently drops blocks it fails to convert, so a count mismatch means that order can no
    longer be trusted, and a page must not be written with its tables in the wrong places.

    The page's databases are listed even when no marker was found, because a container block
    notion2md fails to convert takes the markers nested under it down with it. Trusting an
    absence of markers would write the page without tables it is supposed to carry.
    """
    database_ids = find_child_database_ids(client, page_id)
    marker_count = len(INDENTED_CHILD_DATABASE_MARKER.findall(markdown))

    if not database_ids and not marker_count:
        return markdown

    if marker_count != len(database_ids):
        raise DatabaseExportError(
            f"page {page_id} carries {marker_count} inline database markers for "
            f"{len(database_ids)} databases, so they cannot be matched to each other"
        )

    # Matching by position is the only option left: a marker carries no database id. Equal
    # counts do not prove equal order, so a block type notion2md walks differently would
    # place tables under the wrong markers. No signal is available to detect that.

    for database_id in database_ids:
        markdown = replace_marker(markdown, render_child_database(client, database_id))

    return markdown


def render_child_database(client: Any, database_id: str) -> str:
    """Render a database embedded in a page, using the view the page displays."""
    try:
        title, table = get_database_as_markdown(client, database_id, use_default_view=True)
    except Exception as error:
        raise DatabaseExportError(
            f"inline database {database_id} could not be exported: {truncate(str(error))}"
        ) from error

    return f"**{title}**\n\n{table}"


def replace_marker(markdown: str, replacement: str, count: int = 1) -> str:
    """Replace database markers, dropping the indentation notion2md added around them.

    A function is used as the replacement so table cells escaped with backslashes are not
    reinterpreted as regex group references.
    """
    return INDENTED_CHILD_DATABASE_MARKER.sub(lambda _: replacement, markdown, count=count)


def find_child_database_ids(client: Any, block_id: str) -> list[str]:
    """Collect child database ids in the order notion2md walks the block tree."""
    database_ids: list[str] = []

    for block in list_children(client, block_id):
        if block["type"] == "child_database":
            database_ids.append(block["id"])
        elif block.get("has_children") and block["type"] not in SKIPPED_CONTAINERS:
            database_ids.extend(find_child_database_ids(client, block["id"]))

    return database_ids


# notion2md does not walk into these, and neither holds a database: a child page is a
# document of its own, and a table only holds rows
SKIPPED_CONTAINERS = frozenset({"child_page", "table"})


def list_children(client: Any, block_id: str) -> list[dict[str, Any]]:
    """List the child blocks of a block, following pagination.

    Bounded so a cursor that never advances cannot hang a sync. Stopping short loses database
    markers, which fails the page rather than writing it without its tables.
    """
    blocks: list[dict[str, Any]] = []
    cursor: str | None = None

    for _ in range(MAX_PAGES):
        response = cast(dict[str, Any], client.blocks.children.list(block_id, **paginated(cursor)))
        blocks.extend(response.get("results", []))
        cursor = response["next_cursor"] if response.get("has_more") else None
        if not cursor:
            break

    return blocks


def fetch_rows(client: Any, database: dict[str, Any], view_id: str | None) -> DatabaseRows:
    """Fetch database rows, restricted to a view's filters, sorts and columns when targeted."""
    if view_id is None:
        # Only MAX_RENDERED_ROWS reach the table, so one extra row is enough to know more
        # exist. Scanning every row just to count them would cost dozens of sequential
        # requests against a rate limit that allows very few.
        fetched = fetch_rows_by_id(client, database, limit=MAX_RENDERED_ROWS + 1)
        return DatabaseRows(
            rows=list(fetched.rows.values()),
            total=len(fetched.rows) if fetched.exhausted else None,
            complete=fetched.exhausted,
        )

    view = fetch_view_rows(client, view_id)

    # Ids past the render budget would never reach the table, so matching them would spend
    # requests on rows nothing shows and count their absence as rows missing from the middle.
    wanted = view.row_ids[:MAX_RENDERED_ROWS]
    if not wanted:
        return DatabaseRows(rows=[], total=view.total, complete=view.complete)

    fetched = fetch_rows_by_id(client, database, wanted_ids=set(wanted), data_source_id=view.data_source_id)
    fetched.rows.update(retrieve_missing_rows(client, [row_id for row_id in wanted if row_id not in fetched.rows]))

    found = [fetched.rows[row_id] for row_id in wanted if row_id in fetched.rows]
    unmatched = len(wanted) - len(found)
    if unmatched > MAX_INDIVIDUAL_LOOKUPS:
        raise ValueError(f"only {len(found)} of the {len(wanted)} rows this view selects could be read")

    columns = resolve_columns(view.columns, found)

    return DatabaseRows(
        rows=found,
        total=view.total,
        complete=view.complete,
        columns=columns,
        unmatched=unmatched,
        unmatched_columns=check_columns_match(columns, found),
    )


def retrieve_missing_rows(client: Any, missing: list[str]) -> dict[str, dict[str, Any]]:
    """Read rows a data source scan never reached, one request each.

    A scan stops at the row budget, so a view over a large database can select rows it never
    saw. Reading them individually recovers the table rather than reporting them missing, and
    is only worth doing while there are few of them.
    """
    if not missing or len(missing) > MAX_INDIVIDUAL_LOOKUPS:
        return {}

    rows: dict[str, dict[str, Any]] = {}
    for row_id in missing:
        try:
            page = cast(dict[str, Any], client.pages.retrieve(page_id=row_id))
        except Exception:  # noqa: BLE001 - an unreadable row is reported as unmatched instead
            continue
        rows[page["id"]] = page

    return rows


def fetch_rows_by_id(
    client: Any,
    database: dict[str, Any],
    wanted_ids: set[str] | None = None,
    limit: int = MAX_FETCHED_ROWS,
    data_source_id: str | None = None,
) -> FetchedRows:
    """Fetch rows of every data source of a database, keyed by page id.

    A view query returns page references without their values, so values are read from the
    data sources and matched locally. That costs one pass over a data source instead of one
    request per row, which matters against Notion's rate limit, and stops as soon as every
    wanted row has been seen.
    """
    data_sources = database.get("data_sources") or []
    if not data_sources:
        raise ValueError(f"database {database.get('id')} exposes no data source to read rows from")

    # A view names the data source it reads, so only that one is scanned. Without this a
    # database with several sources could exhaust the row budget on the wrong one and report
    # every row of the view as unmatched.
    data_sources = matching_data_sources(data_sources, data_source_id)

    rows: dict[str, dict[str, Any]] = {}

    for data_source in data_sources:
        cursor: str | None = None
        for page in range(MAX_PAGES):
            response = cast(dict[str, Any], client.data_sources.query(data_source["id"], **paginated(cursor)))
            for row in response.get("results", []):
                rows[row["id"]] = row
            if wanted_ids is not None and wanted_ids <= rows.keys():
                return FetchedRows(rows=rows, exhausted=True)
            cursor = response["next_cursor"] if response.get("has_more") else None
            if not cursor:
                break
            if len(rows) >= limit or page == MAX_PAGES - 1:
                return FetchedRows(rows=rows, exhausted=False)

    return FetchedRows(rows=rows, exhausted=True)


def matching_data_sources(data_sources: list[dict[str, Any]], data_source_id: str | None) -> list[dict[str, Any]]:
    """Narrow a database's data sources to the one a view reads.

    Ids are compared bare because the two endpoints need not spell them the same way. A view
    naming a source the database does not list still falls back to scanning all of them: rows
    are selected by id, so the table stays correct and only costs extra requests.
    """
    if not data_source_id:
        return data_sources

    wanted = data_source_id.replace("-", "").lower()

    return [source for source in data_sources if str(source.get("id", "")).replace("-", "").lower() == wanted] or (
        data_sources
    )


def find_default_view_id(client: Any, database_id: str) -> str:
    """Return the view Notion displays first for a database.

    Notion exposes no "default view" flag, so the first listed view is taken to be the one a
    page renders. An empty list is a failure rather than "no view": a database embedded in a
    page always has one, so an empty result means the views could not be read, and exporting
    every row instead would widen the export past what the page shows.
    """
    try:
        response = cast(dict[str, Any], client.views.list(database_id=database_id))
        return cast(str, response["results"][0]["id"])
    except Exception as error:
        raise ViewUnavailableError(
            f"could not resolve the displayed view of database {database_id}: {truncate(str(error))}"
        ) from error


def fetch_view_rows(client: Any, view_id: str) -> ViewRows:
    """Run a view's saved filters and sorts, returning the row ids it selects."""
    try:
        return query_view(client, view_id)
    except Exception as error:
        raise ViewUnavailableError(f"could not query view {view_id}: {truncate(str(error))}") from error


def query_view(client: Any, view_id: str) -> ViewRows:
    """Read a view's displayed columns, then execute it and page through its cached results.

    Reading the view costs one extra request, which buys fidelity the row ids cannot: a view
    hides properties, and rendering every property of a row would expose columns the page
    deliberately leaves out.
    """
    view = cast(dict[str, Any], client.views.retrieve(view_id))
    view_type = view.get("type")
    if view_type not in ROW_VIEW_TYPES:
        raise ValueError(f"view {view_id} is of type {view_type!r}, which presents no rows to export")

    response = cast(dict[str, Any], client.views.queries.create(view_id))
    query_id = response.get("id")
    total = response.get("total_count")
    row_ids = [row["id"] for row in response.get("results", [])]
    incomplete = reports_incomplete(response)

    # Only MAX_RENDERED_ROWS reach the table and total_count already carries the true count,
    # so paging every id would spend requests on rows nothing will show
    for _ in range(MAX_PAGES):
        if not response.get("has_more") or len(row_ids) >= MAX_RENDERED_ROWS:
            break
        cursor = response.get("next_cursor")
        if not query_id or not cursor:
            raise ValueError("view query reported more results but returned no cursor to reach them")
        response = cast(dict[str, Any], client.views.queries.results(view_id, query_id, start_cursor=cursor))
        row_ids.extend(row["id"] for row in response.get("results", []))
        incomplete = incomplete or reports_incomplete(response)

    return ViewRows(
        row_ids=row_ids,
        total=total if isinstance(total, int) else len(row_ids),
        complete=isinstance(total, int) and not incomplete,
        columns=visible_columns(view),
        data_source_id=view.get("data_source_id"),
    )


def visible_columns(view: dict[str, Any]) -> list[dict[str, Any]] | None:
    """The properties a view displays, in display order, each by id and name.

    Returns None when the view carries no column list at all, which is how view types with
    nothing to honour are handled: every column is then rendered.

    A list that yields nothing visible is a different matter. Rendering every column would
    put back exactly what the view hides, so an unrecognised shape raises rather than falls
    back. Names are resolved later, since a configuration may carry ids alone.
    """
    properties = (view.get("configuration") or {}).get("properties")
    if properties is None:
        return None
    if not isinstance(properties, list):
        raise ValueError(f"view configuration lists properties as {type(properties).__name__}, not a list")

    visible = [column_of(prop) for prop in properties if prop.get("visible")]
    if visible:
        return visible

    if not any("visible" in prop for prop in properties):
        raise ValueError(f"no property among {len(properties)} declares whether it is visible")

    # A board, gallery or map view can legitimately hide every property and show titles alone.
    # Keeping the title preserves the rows without rendering what the view hides.
    title = next((prop for prop in properties if prop.get("property_id") == "title"), None)
    if not title:
        raise ValueError(f"view hides all {len(properties)} properties and exposes no title column")

    return [column_of(title)]


def column_of(prop: dict[str, Any]) -> dict[str, Any]:
    return {"id": prop.get("property_id"), "name": prop.get("property_name")}


def resolve_columns(columns: list[dict[str, Any]] | None, rows: list[dict[str, Any]]) -> list[str] | None:
    """Name each displayed column, falling back to the ids the rows carry.

    property_name is a convenience the configuration need not include, so a column known only
    by its id is matched against the properties of the rows themselves.
    """
    if columns is None:
        return None

    names_by_id = {prop.get("id"): name for row in rows for name, prop in row.get("properties", {}).items()}
    resolved = [column["name"] or names_by_id.get(column["id"]) for column in columns]
    named = [name for name in resolved if name]

    if not named:
        raise ValueError(f"none of the {len(columns)} columns the view displays could be named")

    return named


def reports_incomplete(response: dict[str, Any]) -> bool:
    """Whether Notion capped the view query's cached results."""
    return (response.get("request_status") or {}).get("type") == "incomplete"


def check_columns_match(columns: list[str] | None, rows: list[dict[str, Any]]) -> list[str]:
    """Report columns a view displays that match no property its rows carry.

    Column names come from the view configuration and values from the data source. If a
    rename left the two disagreeing, cells render blank and the real values are dropped, so
    a partial mismatch is reported alongside the table and a total one fails the export.
    """
    if not columns or not rows:
        return []

    known = {name for row in rows for name in row.get("properties", {})}
    if not known:
        return []

    unmatched = [column for column in columns if column not in known]
    if len(unmatched) == len(columns):
        raise ValueError(f"none of the view's columns {columns} match the properties of its rows")

    return unmatched


def render_table(rows: DatabaseRows) -> str:
    """Render database rows as a markdown table."""
    rendered = rows.rows[:MAX_RENDERED_ROWS]
    notes = coverage_notes(len(rendered), rows)

    if not rendered:
        return "\n\n".join(["_No rows._", *notes])

    columns = rows.columns or collect_columns(rendered)
    lines = [
        f"| {' | '.join(escape_cell(column) for column in columns)} |",
        f"| {' | '.join('---' for _ in columns)} |",
    ]
    lines.extend(render_row(row, columns) for row in rendered)
    lines.extend(f"\n{note}" for note in notes)

    return "\n".join(lines)


def coverage_notes(rendered_count: int, rows: DatabaseRows) -> list[str]:
    """Describe what the table leaves out, never understating an unknown remainder.

    Rows missing from the middle are reported apart from rows cut off the end, since a reader
    cannot tell the two apart from the table itself.
    """
    notes: list[str] = []

    if rows.unmatched_columns:
        notes.append(
            f"_{pluralise('Column', len(rows.unmatched_columns))} "
            f"{', '.join(rows.unmatched_columns)} matched no property on these rows and render empty._"
        )

    if rows.unmatched:
        notes.append(
            f"_{rows.unmatched} {pluralise('row', rows.unmatched)} the view selects "
            "could not be matched to their values, so they are missing from this table._"
        )

    notes.extend(truncation_note(rendered_count, rows))
    return notes


def truncation_note(rendered_count: int, rows: DatabaseRows) -> list[str]:
    """Describe the rows past the end of the table, if any."""
    if rows.total is None:
        return [f"_More rows exist than the {rendered_count} exported here._"]

    missing = max(rows.total - rendered_count - rows.unmatched, 0)
    if not missing:
        return [] if rows.complete else ["_Some rows could not be fetched, so this table may be incomplete._"]

    counted = f"{missing} more {pluralise('row', missing)} not exported."
    return [f"_{counted}_"] if rows.complete else [f"_At least {counted}_"]


def pluralise(word: str, count: int) -> str:
    return word if count == 1 else f"{word}s"


def render_row(row: dict[str, Any], columns: list[str]) -> str:
    properties = row.get("properties", {})
    return f"| {' | '.join(format_property(properties.get(column, {})) for column in columns)} |"


def collect_columns(rows: list[dict[str, Any]]) -> list[str]:
    """List column names across all rows, with the title column first."""
    columns: list[str] = []
    for row in rows:
        for name in row.get("properties", {}):
            if name not in columns:
                columns.append(name)

    title_column = find_title_column(rows)
    if title_column in columns:
        columns.remove(title_column)
        columns.insert(0, title_column)

    return columns


def find_title_column(rows: list[dict[str, Any]]) -> str | None:
    for row in rows:
        for name, prop in row.get("properties", {}).items():
            if prop.get("type") == "title":
                return name
    return None


def format_property(prop: dict[str, Any]) -> str:
    """Render a Notion property value as a single markdown table cell."""
    return escape_cell(format_value(prop))


def format_value(prop: dict[str, Any]) -> str:
    """Render a property value as plain text, leaving markdown escaping to the caller."""
    formatter = PROPERTY_FORMATTERS.get(prop.get("type", ""))
    value = formatter(prop) if formatter else ""
    return "" if value is None else str(value)


def escape_cell(value: Any) -> str:
    """Render a value as a single-line markdown cell, escaping the column separator.

    Backslashes are escaped first, so a value already containing one does not leave a live
    delimiter behind and shift the row's columns.
    """
    if value is None:
        return ""
    text = str(value).replace("\r\n", "\n").replace("\r", "\n")
    return text.replace("\\", "\\\\").replace("|", "\\|").replace("\n", " ").strip()


def truncate(text: str) -> str:
    return text if len(text) <= MAX_ERROR_LENGTH else f"{text[:MAX_ERROR_LENGTH]}…"


def paginated(cursor: str | None) -> dict[str, Any]:
    args: dict[str, Any] = {"page_size": PAGE_SIZE}
    if cursor:
        args["start_cursor"] = cursor
    return args


def join_rich_text(rich_text: list[dict[str, Any]]) -> str:
    return "".join(part.get("plain_text", "") for part in rich_text)


def format_date(prop: dict[str, Any]) -> str:
    return format_date_value(prop.get("date"))


def format_date_value(date: Any) -> str:
    """Render a Notion date object, which computed properties also carry."""
    if not isinstance(date, dict):
        return ""
    start, end = date.get("start", ""), date.get("end")
    return f"{start} → {end}" if end else start


def format_formula(prop: dict[str, Any]) -> str:
    formula = prop.get("formula") or {}
    return format_computed(formula.get("type", ""), formula)


def format_scalar(value: Any) -> str:
    """Render a scalar, spelling booleans the same way checkbox properties are spelled."""
    if value is None:
        return ""
    if isinstance(value, bool):
        return "true" if value else "false"
    return str(value)


def format_rollup(prop: dict[str, Any]) -> str:
    rollup = prop.get("rollup") or {}
    kind = rollup.get("type", "")
    if kind == "array":
        return ", ".join(format_value(item) for item in rollup.get("array", []))
    return format_computed(kind, rollup)


def format_computed(kind: str, payload: dict[str, Any]) -> str:
    """Render the value of a formula or rollup, whose type decides how to read it."""
    value = payload.get(kind)
    return format_date_value(value) if kind == "date" else format_scalar(value)


def format_unique_id(prop: dict[str, Any]) -> str:
    unique_id = prop.get("unique_id") or {}
    prefix, number = unique_id.get("prefix"), unique_id.get("number")
    if number is None:
        return ""
    return f"{prefix}-{number}" if prefix else str(number)


def format_place(prop: dict[str, Any]) -> str:
    """Render a place by what names it, falling back to its coordinates."""
    place = prop.get("place") or {}
    named = ", ".join(str(part) for part in (place.get("name"), place.get("address")) if part)
    if named:
        return named

    latitude, longitude = place.get("latitude"), place.get("longitude")

    return f"{latitude}, {longitude}" if latitude is not None and longitude is not None else ""


def format_verification(prop: dict[str, Any]) -> str:
    """Render a wiki verification, whose state is what distinguishes a trusted row."""
    verification = prop.get("verification") or {}
    state = verification.get("state") or ""
    verified_by = (verification.get("verified_by") or {}).get("name")

    return f"{state} by {verified_by}" if state and verified_by else state


def format_relation(prop: dict[str, Any]) -> str:
    """Report how many pages a relation links to.

    Notion truncates relations in query responses and flags the rest with has_more, so the
    count is reported as a lower bound rather than as an exact figure it may not be.
    """
    linked = prop.get("relation") or []
    if not linked:
        return ""
    return f"{len(linked)}+ linked" if prop.get("has_more") else f"{len(linked)} linked"


def format_names(items: list[dict[str, Any]]) -> str:
    return ", ".join(str(item.get("name") or "") for item in items)


PROPERTY_FORMATTERS: dict[str, Any] = {
    "title": lambda p: join_rich_text(p.get("title", [])),
    "rich_text": lambda p: join_rich_text(p.get("rich_text", [])),
    "number": lambda p: "" if p.get("number") is None else str(p["number"]),
    "select": lambda p: (p.get("select") or {}).get("name", ""),
    "status": lambda p: (p.get("status") or {}).get("name", ""),
    "multi_select": lambda p: format_names(p.get("multi_select", [])),
    "date": format_date,
    "checkbox": lambda p: "true" if p.get("checkbox") else "false",
    "people": lambda p: format_names(p.get("people", [])),
    "files": lambda p: format_names(p.get("files", [])),
    "url": lambda p: p.get("url") or "",
    "email": lambda p: p.get("email") or "",
    "phone_number": lambda p: p.get("phone_number") or "",
    "created_time": lambda p: p.get("created_time") or "",
    "last_edited_time": lambda p: p.get("last_edited_time") or "",
    "created_by": lambda p: (p.get("created_by") or {}).get("name", ""),
    "last_edited_by": lambda p: (p.get("last_edited_by") or {}).get("name", ""),
    "relation": lambda p: format_relation(p),
    "place": format_place,
    "verification": format_verification,
    "formula": format_formula,
    "rollup": format_rollup,
    "unique_id": format_unique_id,
}
