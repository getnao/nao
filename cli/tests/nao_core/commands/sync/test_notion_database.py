"""Unit tests for the Notion database exporter."""

from unittest.mock import MagicMock

import pytest

from nao_core.commands.sync.providers.notion.database import (
    CHILD_DATABASE_MARKER,
    MAX_PAGES,
    MAX_RENDERED_ROWS,
    PAGE_SIZE,
    DatabaseExportError,
    DatabaseRows,
    ViewUnavailableError,
    collect_columns,
    fetch_rows,
    fetch_rows_by_id,
    fetch_view_rows,
    find_child_database_ids,
    find_default_view_id,
    format_property,
    inject_child_databases,
    list_children,
    matching_data_sources,
    render_table,
    visible_columns,
)


def text_property(value: str) -> dict:
    return {"type": "rich_text", "rich_text": [{"plain_text": value}]}


def title_property(value: str) -> dict:
    return {"type": "title", "title": [{"plain_text": value}]}


def row(row_id: str, name: str, definition: str = "") -> dict:
    return {
        "id": row_id,
        "properties": {"Definition": text_property(definition), "Name": title_property(name)},
    }


def stub_view(client: MagicMock, detail: dict, query: dict, pages: list[dict] | None = None) -> None:
    """Stub the typed Views calls: retrieve the view, run it, then page its results."""
    client.views.retrieve.return_value = detail
    client.views.queries.create.return_value = query
    if pages is not None:
        client.views.queries.results.side_effect = pages


def rows_of(*pages: dict) -> DatabaseRows:
    return DatabaseRows(rows=list(pages), total=len(pages), complete=True)


def test_render_table_puts_title_column_first():
    table = render_table(rows_of(row("a", "carpool_app", "The app used")))

    assert table.splitlines()[0] == "| Name | Definition |"
    assert table.splitlines()[2] == "| carpool_app | The app used |"


def test_render_table_escapes_pipes_and_newlines():
    table = render_table(rows_of(row("a", "name", "a | b\nsecond line")))

    assert "a \\| b second line" in table


def delimiter_count(line: str) -> int:
    """Count the pipes markdown treats as column delimiters, ignoring escaped ones."""
    return line.replace("\\|", "").count("|")


def test_render_table_escapes_column_names():
    lines = render_table(rows_of({"id": "a", "properties": {"Cost | USD": text_property("5")}})).splitlines()

    assert lines[0] == "| Cost \\| USD |"
    assert delimiter_count(lines[0]) == delimiter_count(lines[1])


def test_render_table_without_rows():
    assert render_table(DatabaseRows(rows=[], total=0, complete=True)) == "_No rows._"


def test_render_table_reports_rows_beyond_what_was_fetched():
    fetched = [row(f"row-{index}", f"name-{index}") for index in range(3)]
    table = render_table(DatabaseRows(rows=fetched, total=1200, complete=True))

    assert "_1197 more rows not exported._" in table


def test_render_table_does_not_understate_a_known_remainder():
    table = render_table(DatabaseRows(rows=[row("a", "x")], total=50, complete=False))

    assert "_At least 49 more rows not exported._" in table


def test_render_table_says_more_exist_when_the_count_is_unknown():
    table = render_table(DatabaseRows(rows=[row("a", "x")], total=None, complete=False))

    assert "_More rows exist than the 1 exported here._" in table


def test_render_table_flags_incompleteness_even_without_a_known_count():
    table = render_table(DatabaseRows(rows=[row("a", "x")], total=1, complete=False))

    assert "may be incomplete" in table


def test_collect_columns_unions_all_rows():
    rows = [
        {"id": "a", "properties": {"Name": title_property("a")}},
        {"id": "b", "properties": {"Extra": text_property("x"), "Name": title_property("b")}},
    ]

    assert collect_columns(rows) == ["Name", "Extra"]


def test_fetch_rows_applies_view_filter_and_order():
    client = MagicMock()
    client.data_sources.query.return_value = {
        "results": [row("row-1", "b"), row("row-2", "a"), row("row-3", "c")],
        "has_more": False,
    }
    stub_view(
        client,
        {"type": "table", "configuration": {"properties": [{"property_name": "Name", "visible": True}]}},
        {"results": [{"id": "row-2"}, {"id": "row-1"}], "has_more": False, "id": "query-1", "total_count": 2},
    )

    rows = fetch_rows(client, {"id": "db", "data_sources": [{"id": "ds"}]}, view_id="view-1")

    assert [r["id"] for r in rows.rows] == ["row-2", "row-1"]
    assert rows.total == 2
    assert rows.complete


def test_fetch_rows_exports_everything_when_no_view_is_targeted():
    client = MagicMock()
    client.data_sources.query.return_value = {"results": [row("row-1", "a")], "has_more": False}

    rows = fetch_rows(client, {"id": "db", "data_sources": [{"id": "ds"}]}, view_id=None)

    assert [r["id"] for r in rows.rows] == ["row-1"]
    client.views.retrieve.assert_not_called()


def test_fetch_rows_fails_rather_than_widening_a_failed_view():
    client = MagicMock()
    client.data_sources.query.return_value = {"results": [row("row-1", "a")], "has_more": False}
    client.views.retrieve.side_effect = RuntimeError("rate limited")

    with pytest.raises(ViewUnavailableError):
        fetch_rows(client, {"id": "db", "data_sources": [{"id": "ds"}]}, view_id="view-1")


def test_fetch_rows_reports_an_unknown_remainder_instead_of_scanning_everything():
    client = MagicMock()
    client.data_sources.query.side_effect = [
        {
            "results": [row(f"row-{page * PAGE_SIZE + index}", "x") for index in range(PAGE_SIZE)],
            "has_more": True,
            "next_cursor": "c",
        }
        for page in range(MAX_PAGES)
    ]

    rows = fetch_rows(client, {"id": "db", "data_sources": [{"id": "ds"}]}, view_id=None)

    assert rows.total is None
    assert not rows.complete
    assert client.data_sources.query.call_count == MAX_RENDERED_ROWS // PAGE_SIZE + 1


def test_fetch_rows_by_id_requires_a_data_source():
    with pytest.raises(ValueError, match="no data source"):
        fetch_rows_by_id(MagicMock(), {"id": "db", "data_sources": []})


def test_visible_columns_keeps_display_order_and_drops_hidden_properties():
    view = {
        "configuration": {
            "properties": [
                {"property_name": "Name", "visible": True},
                {"property_name": "Definition", "visible": True},
                {"property_name": "Validated table", "visible": False},
            ]
        }
    }

    assert [column["name"] for column in visible_columns(view) or []] == ["Name", "Definition"]
    assert visible_columns({}) is None


def test_render_table_renders_only_the_columns_a_view_displays():
    rows = DatabaseRows(
        rows=[{"id": "a", "properties": {"Name": title_property("country"), "Hidden": text_property("secret")}}],
        total=1,
        complete=True,
        columns=["Name"],
    )

    table = render_table(rows)

    assert table.splitlines()[0] == "| Name |"
    assert "secret" not in table


def test_render_table_keeps_the_incompleteness_note_when_no_row_survived():
    table = render_table(DatabaseRows(rows=[], total=27, complete=False))

    assert "_No rows._" in table
    assert "At least 27 more rows not exported" in table


def test_fetch_view_rows_fails_when_pagination_cannot_continue():
    client = MagicMock()
    stub_view(
        client, {"type": "table"}, {"results": [{"id": "row-1"}], "has_more": True, "next_cursor": None, "id": "q"}
    )

    with pytest.raises(ViewUnavailableError):
        fetch_view_rows(client, "view-1")


def test_fetch_view_rows_marks_capped_results_incomplete():
    client = MagicMock()
    stub_view(
        client,
        {"type": "table"},
        {
            "results": [{"id": "row-1"}],
            "has_more": False,
            "id": "q",
            "total_count": 1,
            "request_status": {"type": "incomplete", "incomplete_reason": "query_result_limit_reached"},
        },
    )

    assert fetch_view_rows(client, "view-1").complete is False


def test_fetch_view_rows_rejects_a_view_that_presents_no_rows():
    client = MagicMock()
    client.views.retrieve.return_value = {"type": "chart"}

    with pytest.raises(ViewUnavailableError, match="presents no rows"):
        fetch_view_rows(client, "view-1")


def test_find_default_view_id_fails_rather_than_widening_on_an_empty_list():
    client = MagicMock()
    client.views.list.return_value = {"results": []}

    with pytest.raises(ViewUnavailableError):
        find_default_view_id(client, "db")


def test_find_default_view_id_fails_when_the_lookup_errors():
    client = MagicMock()
    client.views.list.side_effect = RuntimeError("boom")

    with pytest.raises(ViewUnavailableError):
        find_default_view_id(client, "db")


def test_fetch_rows_by_id_stops_once_every_wanted_row_is_found():
    client = MagicMock()
    client.data_sources.query.side_effect = [
        {"results": [row("row-1", "a")], "has_more": True, "next_cursor": "cursor-1"},
        {"results": [row("row-2", "b")], "has_more": True, "next_cursor": "cursor-2"},
    ]

    fetched = fetch_rows_by_id(client, {"data_sources": [{"id": "ds"}]}, wanted_ids={"row-1", "row-2"})

    assert set(fetched.rows) == {"row-1", "row-2"}
    assert fetched.exhausted
    assert client.data_sources.query.call_count == 2


def test_list_children_stops_when_pagination_returns_no_cursor():
    client = MagicMock()
    client.blocks.children.list.return_value = {"results": [{"id": "a"}], "has_more": True, "next_cursor": None}

    assert list_children(client, "page") == [{"id": "a"}]


def test_find_child_database_ids_walks_nested_blocks():
    client = MagicMock()
    client.blocks.children.list.side_effect = [
        {
            "results": [
                {"id": "col", "type": "column", "has_children": True},
                {"id": "db-top", "type": "child_database", "has_children": False},
            ],
            "has_more": False,
        },
        {"results": [{"id": "db-nested", "type": "child_database", "has_children": False}], "has_more": False},
    ]

    assert find_child_database_ids(client, "page") == ["db-nested", "db-top"]


def stub_inline_database(client: MagicMock, title: str = "Columns details") -> None:
    """Stub the three requests an embedded database needs: list views, read one, query it."""
    client.databases.retrieve.return_value = {
        "title": [{"plain_text": title}],
        "id": "db-1",
        "data_sources": [{"id": "ds-1"}],
    }
    client.data_sources.query.return_value = {"results": [row("row-1", "country", "Trip country")], "has_more": False}
    client.views.list.return_value = {"results": [{"id": "view-1"}]}
    stub_view(
        client,
        {
            "type": "table",
            "configuration": {
                "properties": [
                    {"property_name": "Name", "visible": True},
                    {"property_name": "Definition", "visible": True},
                ]
            },
        },
        {"results": [{"id": "row-1"}], "has_more": False, "id": "query-1", "total_count": 1},
    )


def test_inject_child_databases_replaces_marker_with_table():
    client = MagicMock()
    client.blocks.children.list.return_value = {
        "results": [{"id": "db-1", "type": "child_database", "has_children": False}],
        "has_more": False,
    }
    stub_inline_database(client)

    markdown = inject_child_databases(client, "page", f"intro\n\n{CHILD_DATABASE_MARKER}\n\noutro")

    assert CHILD_DATABASE_MARKER not in markdown
    assert "**Columns details**" in markdown
    assert "| country | Trip country |" in markdown
    assert markdown.startswith("intro")
    assert markdown.endswith("outro")


def test_inject_child_databases_drops_the_indentation_around_a_nested_marker():
    client = MagicMock()
    client.blocks.children.list.return_value = {
        "results": [{"id": "db-1", "type": "child_database", "has_children": False}],
        "has_more": False,
    }
    stub_inline_database(client)

    markdown = inject_child_databases(client, "page", f"- toggle\n\t{CHILD_DATABASE_MARKER}\n")

    assert "\t**Columns details**" not in markdown
    assert "**Columns details**" in markdown


def test_inject_child_databases_fails_when_markers_and_databases_disagree():
    client = MagicMock()
    client.blocks.children.list.return_value = {
        "results": [
            {"id": "db-1", "type": "child_database", "has_children": False},
            {"id": "db-2", "type": "child_database", "has_children": False},
        ],
        "has_more": False,
    }

    with pytest.raises(DatabaseExportError, match="cannot be matched"):
        inject_child_databases(client, "page", f"a\n{CHILD_DATABASE_MARKER}\n")
    client.databases.retrieve.assert_not_called()


def test_inject_child_databases_fails_the_page_when_a_database_cannot_be_read():
    client = MagicMock()
    client.blocks.children.list.return_value = {
        "results": [{"id": "db-1", "type": "child_database", "has_children": False}],
        "has_more": False,
    }
    client.databases.retrieve.side_effect = RuntimeError("no access")

    with pytest.raises(DatabaseExportError, match="inline database db-1"):
        inject_child_databases(client, "page", CHILD_DATABASE_MARKER)


def test_inject_child_databases_leaves_a_page_without_databases_alone():
    client = MagicMock()
    client.blocks.children.list.return_value = {"results": [], "has_more": False}

    assert inject_child_databases(client, "page", "no database here") == "no database here"


def test_inject_child_databases_fails_when_notion2md_emitted_no_marker_for_a_database():
    client = MagicMock()
    client.blocks.children.list.return_value = {
        "results": [{"id": "db-1", "type": "child_database", "has_children": False}],
        "has_more": False,
    }

    with pytest.raises(DatabaseExportError, match="cannot be matched"):
        inject_child_databases(client, "page", "a page whose container block was dropped")


def test_list_children_stops_when_a_cursor_never_advances():
    client = MagicMock()
    client.blocks.children.list.return_value = {"results": [{"id": "a"}], "has_more": True, "next_cursor": "same"}

    assert len(list_children(client, "page")) == MAX_PAGES


def test_list_children_stops_when_pages_report_more_but_return_nothing():
    client = MagicMock()
    client.blocks.children.list.return_value = {"results": [], "has_more": True, "next_cursor": "same"}

    assert list_children(client, "page") == []
    assert client.blocks.children.list.call_count == MAX_PAGES


def test_fetch_rows_by_id_stops_when_pages_report_more_but_return_nothing():
    client = MagicMock()
    client.data_sources.query.return_value = {"results": [], "has_more": True, "next_cursor": "same"}

    fetched = fetch_rows_by_id(client, {"id": "db", "data_sources": [{"id": "ds"}]})

    assert fetched.rows == {}
    assert not fetched.exhausted
    assert client.data_sources.query.call_count == MAX_PAGES


def test_matching_data_sources_compares_ids_in_the_same_form():
    sources = [{"id": "aaaaaaaa-0000-0000-0000-000000000001"}, {"id": "aaaaaaaa-0000-0000-0000-000000000002"}]

    assert matching_data_sources(sources, "AAAAAAAA00000000000000000000_0002".replace("_", "")) == [sources[1]]
    assert matching_data_sources(sources, None) == sources
    assert matching_data_sources(sources, "b" * 32) == sources


def test_fetch_view_rows_stops_at_the_render_budget_without_an_extra_page():
    client = MagicMock()
    full_page = {"results": [{"id": f"row-{index}"} for index in range(PAGE_SIZE)], "has_more": True}
    stub_view(client, {"type": "table"}, {**full_page, "id": "q", "next_cursor": "c", "total_count": 5000})
    client.views.queries.results.return_value = {**full_page, "next_cursor": "c"}

    view = fetch_view_rows(client, "view-1")

    assert len(view.row_ids) == MAX_RENDERED_ROWS
    assert client.views.queries.results.call_count == MAX_RENDERED_ROWS // PAGE_SIZE - 1


def test_fetch_view_rows_keeps_an_incomplete_status_from_an_earlier_page():
    client = MagicMock()
    stub_view(
        client,
        {"type": "table"},
        {
            "results": [{"id": "row-1"}],
            "has_more": True,
            "next_cursor": "c",
            "id": "q",
            "total_count": 2,
            "request_status": {"type": "incomplete"},
        },
        [{"results": [{"id": "row-2"}], "has_more": False}],
    )

    assert fetch_view_rows(client, "view-1").complete is False


def test_format_property_handles_common_types():
    assert format_property({"type": "number", "number": 42}) == "42"
    assert format_property({"type": "checkbox", "checkbox": True}) == "true"
    assert format_property({"type": "select", "select": {"name": "verified"}}) == "verified"
    assert format_property({"type": "select", "select": None}) == ""
    assert format_property({"type": "multi_select", "multi_select": [{"name": "a"}, {"name": "b"}]}) == "a, b"
    assert (
        format_property({"type": "date", "date": {"start": "2026-01-01", "end": "2026-02-01"}})
        == "2026-01-01 → 2026-02-01"
    )
    assert format_property({"type": "relation", "relation": [{"id": "x"}]}) == "1 linked"
    assert format_property({"type": "formula", "formula": {"type": "string", "string": "ok"}}) == "ok"
    assert format_property({"type": "unknown_kind"}) == ""


@pytest.mark.parametrize(
    "prop",
    [
        {"type": "people", "people": [{"name": None}]},
        {"type": "files", "files": [{"name": None}]},
        {"type": "multi_select", "multi_select": [{"name": None}]},
        {"type": "select", "select": {"name": None}},
        {"type": "status", "status": {"name": None}},
        {"type": "created_by", "created_by": {"name": None}},
        {"type": "last_edited_by", "last_edited_by": {"name": None}},
    ],
)
def test_format_property_tolerates_null_names(prop):
    assert format_property(prop) == ""


def test_format_property_escapes_a_rollup_array_exactly_once():
    rollup = {
        "type": "rollup",
        "rollup": {"type": "array", "array": [text_property("a | b")]},
    }

    assert format_property(rollup) == "a \\| b"


def test_format_property_normalises_carriage_returns():
    assert format_property(text_property("line1\r\nline2")) == "line1 line2"


def test_format_property_escapes_a_backslash_before_a_pipe():
    assert format_property(text_property("a\\|b")) == "a\\\\\\|b"


def test_visible_columns_raises_when_the_payload_shape_is_unrecognised():
    renamed_key = {"configuration": {"properties": [{"property_name": "Name", "is_visible": True}]}}

    with pytest.raises(ValueError, match="declares whether it is visible"):
        visible_columns(renamed_key)


def test_visible_columns_raises_when_an_all_hidden_view_has_no_title():
    hidden_without_title = {"configuration": {"properties": [{"property_name": "Secret", "visible": False}]}}

    with pytest.raises(ValueError, match="no title column"):
        visible_columns(hidden_without_title)


def test_fetch_view_rows_stops_paging_at_the_render_budget():
    client = MagicMock()
    page = {"results": [{"id": f"row-{index}"} for index in range(100)], "has_more": True, "next_cursor": "c"}
    stub_view(client, {"type": "table"}, {**page, "id": "q", "total_count": 5000}, [page] * 20)

    view = fetch_view_rows(client, "view-1")

    assert len(view.row_ids) <= MAX_RENDERED_ROWS + 100
    assert view.total == 5000
    assert view.complete


def test_fetch_rows_reports_rows_it_could_not_match():
    client = MagicMock()
    client.data_sources.query.return_value = {"results": [row("row-1", "a")], "has_more": False}
    stub_view(
        client,
        {"type": "table"},
        {"results": [{"id": "row-1"}, {"id": "row-missing"}], "has_more": False, "id": "q", "total_count": 2},
    )

    rows = fetch_rows(client, {"id": "db", "data_sources": [{"id": "ds"}]}, view_id="view-1")

    assert rows.unmatched == 1
    assert "could not be matched to their values" in render_table(rows)


def test_fetch_rows_does_not_query_a_data_source_for_an_empty_view():
    client = MagicMock()
    stub_view(client, {"type": "table"}, {"results": [], "has_more": False, "id": "q", "total_count": 0})

    rows = fetch_rows(client, {"id": "db", "data_sources": [{"id": "ds"}]}, view_id="view-1")

    assert rows.rows == []
    client.data_sources.query.assert_not_called()


def test_find_child_database_ids_does_not_walk_into_tables():
    client = MagicMock()
    client.blocks.children.list.return_value = {
        "results": [{"id": "table-1", "type": "table", "has_children": True}],
        "has_more": False,
    }

    assert find_child_database_ids(client, "page") == []
    assert client.blocks.children.list.call_count == 1


def test_fetch_rows_only_scans_the_data_source_its_view_reads():
    client = MagicMock()
    client.data_sources.query.return_value = {"results": [row("row-1", "a")], "has_more": False}
    stub_view(
        client,
        {
            "type": "table",
            "configuration": {"properties": [{"property_name": "Name", "visible": True}]},
            "data_source_id": "ds-2",
        },
        {"results": [{"id": "row-1"}], "has_more": False, "id": "q", "total_count": 1},
    )
    database = {"id": "db", "data_sources": [{"id": "ds-1"}, {"id": "ds-2"}]}

    fetch_rows(client, database, view_id="view-1")

    assert [call.args[0] for call in client.data_sources.query.call_args_list] == ["ds-2"]


def test_fetch_rows_fails_when_view_columns_match_no_property():
    client = MagicMock()
    client.data_sources.query.return_value = {"results": [row("row-1", "a")], "has_more": False}
    stub_view(
        client,
        {"type": "table", "configuration": {"properties": [{"property_name": "Renamed", "visible": True}]}},
        {"results": [{"id": "row-1"}], "has_more": False, "id": "q", "total_count": 1},
    )

    with pytest.raises(ValueError, match="match the properties"):
        fetch_rows(client, {"id": "db", "data_sources": [{"id": "ds"}]}, view_id="view-1")


def test_visible_columns_keeps_the_title_of_an_all_hidden_view():
    view = {
        "configuration": {
            "properties": [
                {"property_id": "title", "property_name": "Name", "visible": False},
                {"property_id": "abc", "property_name": "Secret", "visible": False},
            ]
        }
    }

    assert [column["name"] for column in visible_columns(view) or []] == ["Name"]


def test_format_property_renders_verification_state():
    verified = {"type": "verification", "verification": {"state": "verified", "verified_by": {"name": "Dana"}}}

    assert format_property(verified) == "verified by Dana"
    assert format_property({"type": "verification", "verification": {"state": "unverified"}}) == "unverified"


def test_format_property_renders_computed_dates():
    formula = {"type": "formula", "formula": {"type": "date", "date": {"start": "2026-01-01", "end": None}}}
    rollup = {"type": "rollup", "rollup": {"type": "date", "date": {"start": "2026-01-01", "end": "2026-02-01"}}}

    assert format_property(formula) == "2026-01-01"
    assert format_property(rollup) == "2026-01-01 → 2026-02-01"


def test_format_property_marks_truncated_relations_as_a_lower_bound():
    linked = [{"id": str(index)} for index in range(25)]

    assert format_property({"type": "relation", "relation": linked, "has_more": True}) == "25+ linked"
    assert format_property({"type": "relation", "relation": linked}) == "25 linked"


def test_format_property_renders_zero_and_booleans():
    assert format_property({"type": "unique_id", "unique_id": {"prefix": None, "number": 0}}) == "0"
    assert format_property({"type": "unique_id", "unique_id": {"prefix": "TASK", "number": 0}}) == "TASK-0"
    assert format_property({"type": "formula", "formula": {"type": "boolean", "boolean": True}}) == "true"
    assert format_property({"type": "formula", "formula": {"type": "boolean", "boolean": False}}) == "false"
