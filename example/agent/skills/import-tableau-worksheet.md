---
name: import-tableau-worksheet
description: Import data from a published Tableau worksheet into a nao user's workspace and visualize it with nao. Use when the user explicitly asks to import, analyze, or chart a Tableau worksheet or view. Requires a shell with the nao CLI and Tableau environment variables.
---

# import-tableau-worksheet

Fetch a published Tableau worksheet as CSV, keep it in the user's nao storage, query it with local DuckDB, and optionally display a nao chart.

## Workflow

### 1. Use the nao CLI Tableau connection

Do not search for or call Tableau MCP tools. The nao CLI owns Tableau authentication, workbook discovery, worksheet CSV export, and worksheet image export.

Do not read, print, or return `.env` contents. If the CLI reports missing Tableau environment variables, stop and tell the user:

> Tableau Cloud access is not configured. Please make sure `TABLEAU_SERVER`, `TABLEAU_SITE_NAME`, `TABLEAU_PAT_NAME`, and `TABLEAU_PAT_VALUE` are set in your `.env` file, then retry. `TABLEAU_API_VERSION` is optional. Do not paste credential values into chat.

Report the CLI's sanitized error if Tableau rejects authentication.

### 2. Resolve the worksheet

Require the Tableau workbook and worksheet names. If the user supplied only a worksheet name, ask for its workbook because worksheet names are not globally unique.

- A Tableau import must use the exact requested Tableau workbook and worksheet. Never substitute an unrelated local CSV, database, example dataset, workbook, or similarly named file.
- If the user supplied a local workbook path and that exact file exists, use it. If the requested workbook is not available locally, pass its name to `nao migrate-tableau` so the CLI resolves and downloads it from Tableau Cloud. Do not ask the user to choose an unrelated local workbook first.
- If the exact workbook or worksheet cannot be resolved locally or through Tableau Cloud, stop and report that failure. Do not create a guessed or placeholder nao artifact.
- Match workbook, project, and worksheet names.
- If multiple workbooks match, use the exact project with `--project`.
- If the match is a dashboard, explain that view-data exports may return only one underlying worksheet and ask for the specific published worksheet.
- Pass through only filters the user requested.

Run:

```sh
nao migrate-tableau "<workbook-name>" --output "<temporary-migration-json-path>"
```

Require `_version: "2"` and `success: true`, then select the exact worksheet entry from `worksheet_assets`. Keep the JSON and its `temporary_directory` until the import is complete, then delete both.

### 3. Verify the Tableau view

Before creating any nao file, query, chart, or story, read the selected worksheet asset's `image_path`. Require a successful, readable image; if it is unavailable, stop and report its exact `image_error` or `error`.

Record whether the source is a chart or table and, for a chart, its exact type, orientation, stacking or grouping, axes, measures, dimensions, color series, and visible labels. Never infer its presentation from the worksheet name, CSV columns, or values. If nao has no exact equivalent, identify the closest supported type and record the specific approximation before continuing.

Record every readable Tableau series or category color. Preserve those colors in the nao chart when its chart type supports explicit colors; never substitute black because a color could not be resolved.

Treat an encoding with `channel: "lod"` as Tableau Detail: it identifies individual marks even when it is not drawn on an axis. Preserve every Detail field in the chart-ready query and use it as the point identity or tooltip label when nao supports that encoding. Never replace a Detail value with the numeric X-axis value.

Treat a categorical `channel: "color"` field as a per-mark grouping dimension. Preserve its original values and colors. For scatter plots, keep Detail, Color, X, and Y fields in long-form rows; do not pivot the Color values into separate measure columns when that would discard the Detail field or remove Color from each point.

If nao's supported chart configuration cannot expose a parsed Detail, Color, or tooltip field, keep the field in the query output and report that precise tooltip or encoding limitation. Do not silently drop the field or claim that the interaction matches Tableau.

### 4. Get the worksheet data

Read the selected worksheet asset's `data_path`. Confirm it is non-empty CSV before continuing. If the asset has a `data_error` or `error`, report it without attempting to bypass Tableau permissions.

### 5. Keep the CSV in nao

Save the CSV unchanged to `/home/tableau/<worksheet-name>.csv`, using a filesystem-safe lowercase name. The `/home` file belongs to the current user; do not write worksheet rows into nao's application database.

If storage or the `write` tool is unavailable, explain that the Tableau data cannot be bridged into `execute_sql` in the current deployment.

### 6. Query with local DuckDB

Use `execute_sql` with `database_id: "duckdb_local"` and read the saved file:

```sql
SELECT *
FROM read_csv_auto('/home/tableau/<worksheet-name>.csv')
```

Inspect the columns and types, then run a focused query that produces the dimensions and measures needed for the user's requested analysis. Aggregate large worksheets before charting them.

Alias every chart-ready output column to a lowercase snake-case identifier. Put human-readable text in chart labels, not in `data_key`; spaces and punctuation in series keys can break CSS color resolution.

### 7. Display the result

When the user requested a visualization, call `display_chart` with the query ID returned by the focused `execute_sql` call. Build it from the presentation recorded from the Tableau image. Preserve a source chart as a chart; use a table only when the verified source is a text table/crosstab or the user explicitly requested one. If the chart does not render, fix the query or chart configuration instead of silently downgrading it to a table. Use the recorded closest supported chart only when nao cannot represent the exact Tableau type, and report the approximation.

Tell the user which Tableau worksheet and filters were used and where the imported CSV was saved.

## Guardrails

- Run this workflow only when the user explicitly requests Tableau data.
- When the user requests Tableau, use only data and metadata exported from that exact Tableau workbook and worksheet. Never build the result from an arbitrary local CSV or example database.
- Respect the calling user's Tableau permissions and never request credentials in chat.
- Never read or expose Tableau credentials. The nao CLI owns authentication.
- Do not use Tableau MCP during this workflow.
- Never infer chart type or visual encoding from a worksheet name, CSV fields, or values. Verify the worksheet's Tableau image before creating any nao artifact.
- Never aggregate away or discard a Tableau `lod`/Detail field that identifies individual marks.
- Never use spaces or punctuation in SQL aliases referenced by chart `data_key` values.
- Never silently replace a readable Tableau color with a default or black fallback.
- Do not claim that a nao chart reproduces Tableau's formatting; it visualizes the exported worksheet data.
- Do not use this workflow to copy an entire workbook or dashboard. Hand those requests to migrate-tableau-workbook.
- Do not expose the raw CSV in the answer unless the user asks for it.
