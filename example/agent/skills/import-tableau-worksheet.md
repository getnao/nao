---
name: import-tableau-worksheet
description: Import data from a published Tableau worksheet into a nao user's workspace and visualize it with nao. Use when the user explicitly asks to import, analyze, or chart a Tableau worksheet or view. Requires a configured Tableau MCP server.
---

# import-tableau-worksheet

Fetch a published Tableau worksheet as CSV, keep it in the user's nao storage, query it with local DuckDB, and optionally display a nao chart.

## Workflow

### 1. Find the Tableau MCP tools

Find the configured Tableau server under `/agent/mcps/`. If its folder is empty, connect to it before continuing.

If no Tableau server is configured, tell the user that a project admin must configure Tableau MCP. If authentication is required, stop and ask the user to connect their Tableau account using the provided connection flow.

Read the discovered tool specifications before calling them; do not assume argument names.

### 2. Resolve the worksheet

Use the supplied view ID when the user provides one. Otherwise, use Tableau's workbook and view discovery tools to identify the published worksheet.

- Match workbook, project, and worksheet names.
- If multiple views match, ask the user which one they mean.
- If the match is a dashboard, explain that view-data exports may return only one underlying worksheet and ask for the specific published worksheet.
- Pass through only filters the user requested.

### 3. Get the worksheet data

Call Tableau's `get-view-data` tool for the resolved view. Confirm the result is non-empty CSV before continuing. If Tableau denies access, report the permission problem without attempting to bypass it.

### 4. Keep the CSV in nao

Save the CSV unchanged to `/home/tableau/<worksheet-name>.csv`, using a filesystem-safe lowercase name. The `/home` file belongs to the current user; do not write worksheet rows into nao's application database.

If storage or the `write` tool is unavailable, explain that the Tableau data cannot be bridged into `execute_sql` in the current deployment.

### 5. Query with local DuckDB

Use `execute_sql` with `database_id: "duckdb_local"` and read the saved file:

```sql
SELECT *
FROM read_csv_auto('/home/tableau/<worksheet-name>.csv')
```

Inspect the columns and types, then run a focused query that produces the dimensions and measures needed for the user's requested analysis. Aggregate large worksheets before charting them.

### 6. Display the result

When the user requested a visualization, call `display_chart` with the query ID returned by the focused `execute_sql` call. Choose the chart type from the analytical intent and the returned columns.

Tell the user which Tableau worksheet and filters were used and where the imported CSV was saved.

## Guardrails

- Run this workflow only when the user explicitly requests Tableau data.
- Respect the calling user's Tableau permissions and never request credentials in chat.
- Do not claim that a nao chart reproduces Tableau's formatting; it visualizes the exported worksheet data.
- Do not use this workflow to copy an entire workbook or dashboard. Hand those requests to migrate-tableau-workbook.
- Do not expose the raw CSV in the answer unless the user asks for it.
