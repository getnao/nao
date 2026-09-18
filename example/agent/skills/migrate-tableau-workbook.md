---
name: migrate-tableau-workbook
description: Import or migrate Tableau workbooks, dashboards, worksheets, reports, and views into nao charts or stories according to user intent. Uses the nao CLI for Tableau export and nao MCP for delivery. Requires a shell with the nao CLI and Tableau environment variables.
---

# migrate-tableau-workbook

Use the nao CLI as the only source for Tableau content, then use nao MCP to create the requested chart or story. Preserve analytical meaning and values; approximate unsupported layout and styling explicitly.

## Choose delivery

- One worksheet or view requested for display, import, charting, or analysis → create one chart directly in chat.
- A dashboard, workbook, report, preserved layout, or coordinated set of worksheets → create one story.
- Follow an explicit request for chart or story over these defaults.
- Never create a story solely to display one worksheet unless the user requested a story.

## Workflow

### 1. Use the nao CLI Tableau connection

Do not search for or call Tableau MCP tools. The nao CLI owns Tableau authentication, workbook discovery, downloading, worksheet CSV export, and worksheet image export.

Do not read, print, or return `.env` contents. If the CLI reports missing Tableau environment variables, stop and tell the user:

> Tableau Cloud access is not configured. Please make sure `TABLEAU_SERVER`, `TABLEAU_SITE_NAME`, `TABLEAU_PAT_NAME`, and `TABLEAU_PAT_VALUE` are set in your `.env` file, then retry. `TABLEAU_API_VERSION` is optional. Do not paste credential values into chat.

Report the CLI's sanitized error if Tableau rejects authentication.

### 2. Resolve the migration scope

Use the supplied workbook name or local `.twb`/`.twbx` path. Use `--project` when the user supplied a Tableau project or the CLI reports duplicate workbook names.

- A Tableau migration must use the exact requested Tableau workbook. Never substitute an unrelated local CSV, database, example dataset, workbook, or similarly named file.
- If the user supplied a local path and that exact file exists, use it. If the requested workbook is not available locally, pass its name to `nao migrate-tableau` so the CLI resolves and downloads it from Tableau Cloud. Do not ask the user to choose an unrelated local workbook first.
- If the exact workbook cannot be resolved locally or through Tableau Cloud, stop and report that failure. Do not create a guessed or placeholder nao artifact.
- For one worksheet or view, require its workbook name because worksheet names are not globally unique. Select only its exact `worksheet_assets` entry. If the requested name resolves to a dashboard, ask for the underlying worksheet instead of assuming which sheet to export.
- If the user named one dashboard, migrate only that dashboard. Do not add other dashboards or unplaced worksheets.
- If the user asked for the workbook, create one nao story containing every dashboard and every worksheet not used by a dashboard.
- Put each dashboard in its own tab. A worksheet used by several dashboards belongs in each of those dashboard tabs, but does not get an additional standalone tab.
- Put each unplaced worksheet in its own tab after the dashboard tabs.
- If the workbook contains no dashboards, create one tab per worksheet.

### 3. Get workbook migration metadata — do not guess

The CLI returns workbook composition, worksheet visualization metadata, filter definitions and mappings, exported worksheet data, and source images. Inferring from workbook or view names causes wrong placement.

1. Choose a unique temporary JSON path and run:

```sh
nao migrate-tableau "<workbook-name-or-local-path>" --output "<temporary-migration-json-path>"
```

2. If the CLI reports duplicate workbook names, rerun it with the exact Tableau project:

```sh
nao migrate-tableau "<workbook-name>" --project "<project-name>" --output "<temporary-migration-json-path>"
```

3. Read the generated JSON file. Require `_version` to be `"2"` and `success` to be `true`; otherwise stop and report its `error`. Use `workbook.dashboards` for dashboard composition, `workbook.worksheet_visualizations` for Tableau marks, shelves, encodings, colors, and formatting, `definition.controls` for normalized visible controls, `definition.worksheet_mappings` for each worksheet's explicit `effective_filter_ids` and parameter mappings, and `worksheet_assets` for exported CSV and image paths.
4. Require each migrated worksheet asset to have `success: true`, `data_path`, and `image_path`. Skip a failed worksheet and report its exact `data_error`, `image_error`, or `error`; do not fall back to Tableau MCP or guessed metadata.
5. Keep the migration JSON and `temporary_directory` until validation is complete, then delete both. They are temporary derived artifacts, not user deliverables.

| Tableau                           | nao                                                       |
| --------------------------------- | --------------------------------------------------------- |
| Workbook                          | One story                                                 |
| Dashboard                         | Story tab                                                 |
| Worksheet not used by a dashboard | Story tab                                                 |
| One requested worksheet or view   | Matching chart directly in chat                           |
| Worksheet inside a story          | Matching chart; table only for a source text table/crosstab |
| Published or embedded data source | Warehouse query when mapped; otherwise imported view data |
| Visible dashboard filter control  | Story filter when supported by the parser                 |
| Hidden worksheet filter           | Query constraint only; never a story control              |
| Parameter with allowed values     | Single-select control when its query behavior is reproducible |
| Free-form or range parameter      | Unsupported without a matching native story control       |
| Calculated field                  | SQL expression or documented metric                       |
| Marks card                        | Chart type and series encoding                            |
| Set, group, or bin                | SQL expression or lookup                                  |

Use only the `dashboards[].worksheets` lists the composition parser returns for dashboard membership. During a whole-workbook migration, treat `skipped_worksheets` as standalone worksheet tabs; when there are no dashboards, this includes every worksheet. Do not put those worksheets inside a dashboard tab. If an unplaced worksheet has no successful `worksheet_assets` entry, skip it and report the exact asset error instead of guessing or substituting another view. For a request scoped to one dashboard, ignore `skipped_worksheets`. The parser extracts explicit categorical filters and parameter definitions, but a control is reproducible only when the available data can implement its Tableau behavior.

### 4. Prepare each selected worksheet

Prepare the requested worksheet for chart delivery, or each unique worksheet selected for story delivery:

- Match each worksheet to its exact `worksheet_assets` entry.
- Before creating any nao file, query, chart, or story, read every selected worksheet's `image_path`. Complete this visual preflight for the whole migration first.
- Require a successful, readable image for every worksheet that will be migrated. If an image is unavailable, skip that worksheet and report its exact asset error; never infer its presentation from its name, CSV columns, values, dashboard image, or another worksheet.
- From each worksheet image, record the source presentation: chart or table, exact chart type, orientation, stacking or grouping, axes, measures, dimensions, color series, and visible labels. If nao has no exact equivalent, record the closest supported type and the specific approximation.
- Match that record against the worksheet's `worksheet_visualizations` entry. Use its mark type, rows, columns, encoding channels, stacking mode, explicit color assignments, and formatting as machine-readable evidence; if the XML metadata and image disagree, treat the image as authoritative and report the discrepancy.
- Treat an encoding with `channel: "lod"` as Tableau Detail: it identifies individual marks even when it is not drawn on an axis. Preserve every Detail field in the chart-ready query and use it as the point identity or tooltip label when nao supports that encoding. Never replace a Detail value with the numeric X-axis value.
- Treat a categorical `channel: "color"` field as a per-mark grouping dimension. Preserve its original values and colors. For scatter plots, keep Detail, Color, X, and Y fields in long-form rows; do not pivot the Color values into separate measure columns when that would discard the Detail field or remove Color from each point.
- For a scatter plot with a Detail field, set `tooltip_label_key` to that field's chart-ready SQL alias. Put the Color field and additional Tableau tooltip fields in `tooltip_keys`. Both attributes must reference columns returned by the query.
- If nao's supported chart configuration cannot expose a parsed Detail, Color, or tooltip field, keep the field in the query output and report that precise tooltip or encoding limitation. Do not silently drop the field or claim that the interaction matches Tableau.
- After completing the visual preflight, read each worksheet's exported CSV from `data_path` and require non-empty data. Use it as the Tableau result to match when validating database queries.
- For direct static chart delivery only, save the selected CSV under `/home/tableau/<workbook-name>/<worksheet-name>.csv` and query it with `database_id: "duckdb_local"`.
- For story delivery, require a configured nao database that contains the same source data Tableau used. Query that database directly with its real `database_id`; do not upload or query the CSV as the story's data source.
- Alias every chart-ready SQL output column to a machine-safe lowercase snake-case identifier. Use human-readable labels in chart configuration instead of spaces or punctuation in `data_key`; unsafe keys can break series colors.
- Preserve explicit Tableau palette assignments from `worksheet_visualizations[].colors` whenever nao supports per-series colors. Never replace a readable Tableau color with black merely because a color could not be resolved.
- Build each query and chart from the recorded Tableau presentation, not from an inference based on the exported data. Preserve a Tableau chart as a chart; use a table only when the verified source worksheet is a text table/crosstab or the user explicitly requested a table.

Before story creation, compare each unfiltered database query with the corresponding Tableau CSV. If tables, joins, columns, totals, or dimensions cannot be matched, skip the affected worksheet or control and report the mismatch instead of substituting unrelated project data.

Until richer Tableau definition extractors exist, do not claim that calculated fields, context filters, LOD expressions, sets, groups, bins, marks, or formatting were reproduced from XML. Claim a parameter was reproduced only when its extracted definition, allowed values, target worksheets, and query behavior are all preserved. Preserve what can be verified from exported data and images, and list the rest as unsupported or approximated.

### 5. Deliver one worksheet

For chart delivery, call `display_chart` with the requested worksheet's chart-ready query ID. Build it from the verified image and parsed visualization metadata. Return the chart directly in chat; do not call `create_story`.

Automatically preserve every verified fixed worksheet filter in SQL. A chart displayed directly in chat cannot expose story-style interactive controls; report that limitation instead of silently dropping the source filter state. Apply additional ad hoc filters only when the user requests them. After the chart, add a concise `Migration notes` summary covering each requested feature that was skipped, approximated, or could not be verified.

After validating the chart, delete the CLI migration JSON and its `temporary_directory`.

### 6. Recreate Tableau controls against the shared database

Do this for every dashboard story migration:

1. Treat `definition.controls` as the complete allowlist of visible controls. Use each control's `dashboard`, `id`, `mode`, and `mappings`; never infer additional controls from images, CSV columns, names, or common dashboard patterns.
2. Resolve every mapping's `source_field` to an exact column in the configured source database. Verify its table and required joins through nao context. Apply the control only to the mapping's worksheet.
3. Build and validate each worksheet's source query against the shared database. Compare its unfiltered result with the Tableau CSV before adding filters.
4. Obtain categorical options with `SELECT DISTINCT` from the mapped database column. Parser values may represent only Tableau's current selection, not the complete domain.
5. Add the control and its template predicate during initial story creation. If any mapping or result is ambiguous, skip that control and report why.

Apply filters before aggregation:

```sql
SELECT
    product,
    SUM(sales) AS sales
FROM analytics.orders
WHERE 1 = 1
{% filter region %}
    AND region IN ({{ filters.region.sql }})
{% endfilter %}
GROUP BY product
```

- Tableau categorical include filter → `IN ({{ filters.<id>.sql }})`
- Tableau categorical exclude filter → `NOT IN ({{ filters.<id>.sql }})`
- Fixed or hidden worksheet filter → an ordinary always-on SQL predicate, never an interactive story control
- Date, search, context, and parameter controls → migrate only when their exact database expression and Tableau behavior can be verified

Use `type="multi_select"` for categorical controls because the parser does not distinguish single-value and multiple-value Tableau controls. Keep SQL valid without a selection because nao removes the whole filter block. Use unique lowercase snake-case filter IDs.

```html
<filter id="region" label="Region" type="multi_select" options='["East","West"]' />
```

When at least one interactive control is migrated, have the nao agent generate and execute the final SQL templates inside `ask_nao` so the owning chat persists the SQL and query IDs required by filter refresh and “See query.” Provide exact SQL only for calculations or query behavior that cannot be described unambiguously.

### 7. Create the story

Choose the creation path from the controls that will actually appear in the final story, not merely from controls present in Tableau.

#### Story with interactive controls

Call `ask_nao` once with a compact migration brief. Do not call plain MCP `execute_sql`, `display_chart`, or `create_story` for the final artifact. Include only:

- The story title and tab/worksheet placement.
- The verified source `database_id`, tables, joins, fields, aggregations, and any exact calculated expressions.
- Each chart's type, axes, series, colors, and tooltip fields.
- Each control's ID, label, type, options, mapped database column, and target worksheets.
- Actual migration limitations that need a `Migration notes` tab.

Tell the nao agent to build and execute the filtered queries, create the charts from their returned query IDs, and create exactly one story in the same chat. Do not paste raw migration JSON, CSV rows, validation evidence, repeated warnings, response-format instructions, or full SQL that the nao agent can derive safely from the brief.

If `ask_nao` returns `status: "running"`, poll `get_nao_answer` with its `chatId` until completion. If it requests clarification, relay the question and continue the same chat. Use `get_story` to confirm that every embedded query belongs to that chat.

#### Story without interactive controls

Do not call `ask_nao`. Execute the verified source queries with plain MCP `execute_sql`, create each chart with `display_chart`, and call `create_story` once with the completed content. This intentionally creates a standalone static story and avoids spending tokens on a nao chat. Include no `<filter>` blocks. Report any skipped Tableau controls in `Migration notes`.

Apply these story requirements in either path:

- For a whole workbook, create exactly one story.
- Add dashboard tabs first, in parser order. Each dashboard tab contains only the worksheets from that dashboard's parser result.
- Add one tab per exportable `skipped_worksheets` entry after the dashboard tabs. Each standalone tab contains only that worksheet.
- If there are no dashboards, create one tab per exportable worksheet.
- If the user requested one dashboard, create only that dashboard's story and do not add standalone worksheet tabs.
- A tabbed story must contain only `<tab>` blocks; put no headings, filters, charts, tables, or prose outside them.
- Follow `layout_rows` from top to bottom. Render a one-item row normally and a multi-item row as a `<grid>`; use zone widths as relative grid widths when available.
- Preserve dashboard and standalone worksheet names as tab titles, and worksheet names as chart titles. If tab names collide, add the smallest clear dashboard or worksheet suffix needed to distinguish them.
- Add every supported allowlisted dashboard control during the initial story creation. Add no other story filters.
- Generate a valid `<chart>` block with `display_chart` for every worksheet whose intended presentation is a chart, then embed that returned block in the story.
- When anything was skipped, approximated, or could not be verified, add one final `<tab title="Migration notes">` containing the concise limitation summary described below. Do not add this tab when there are no known limitations.
- Story updates replace the full content. Carry every existing valid chart block into each replacement unless deliberately regenerating that chart. Never substitute `<table>` for `<chart>` to work around a rendering, query, axis, series, or template problem; fix the problem and regenerate the chart block instead.
- Carry every valid `<filter>` block into each full-content replacement. Do not drop, rename, or add filters while troubleshooting unrelated story content.
- Carry the `Migration notes` tab into each full-content replacement and update it when a limitation is resolved or discovered.

Create exactly one story through the selected path. Do not create a chat-linked and standalone copy of the same migration.

### 8. Validate and iterate

1. Compare totals, row counts, filters, and date ranges with Tableau.
2. Compare every chart or table with its required Tableau worksheet image and parsed visualization metadata. Correct chart type, orientation, stacking or grouping, axes, series, labels, and colors before finishing.
3. For story delivery, select every migrated filter and confirm that only its targeted charts change. Treat unchanged charts, failed query refreshes, and “Chart data unavailable” as migration failures. Do not claim that making a story chat-linked fixed its filters without this verification.
4. Resolve every `template_warnings` result before finishing.
5. Fix data discrepancies before styling.
6. Update the existing story instead of creating duplicates.
7. After the final story update, compare its chart/table blocks with the recorded intended presentations. Do not finish if a source chart became a table or disappeared. Temporary diagnostic tables must not remain in the finished story.
8. Compare the final story's `<filter>` blocks with the supported allowlist for each dashboard. Do not finish with a missing allowlisted filter or any filter that was not returned as a dashboard control.
9. For a whole-workbook request, account for every parsed worksheet: it must appear in at least one dashboard tab, appear in a standalone tab, or be listed as skipped with a concrete access or export reason.

### 9. Summarize migration limitations

Build the summary from parser warnings, failed assets, skipped controls, unsupported Tableau behavior, and validation discrepancies. Group related items into at most six short bullets and include only limitations that affected the requested content.

Distinguish the cause precisely:

- **Not supported by nao:** Tableau interactions or presentation behavior that nao cannot represent.
- **Not supported by this migration workflow:** Tableau story points are not parsed or migrated; mention this capability limit for whole-workbook migrations without claiming that the source contains story points.
- **Unavailable from Tableau export:** inaccessible worksheets, incomplete filter domains, or fields absent from exported data.
- **Could not be mapped exactly:** ambiguous filter fields, calculations, parameters, actions, colors, or source tables.
- **Approximated:** chart type, layout, formatting, or interaction replaced with the nearest verified nao equivalent.

Always mention each visible filter or parameter that was skipped and why. The parser does not currently inventory Tableau actions, so note that filter, highlight, URL, navigation, and selection actions could not be assessed for dashboard and workbook migrations. Do not use a vague blanket statement such as “some Tableau features are unsupported.”

Finish with a delivery summary. For one worksheet, report the chart created, source worksheet, filters, saved snapshot, and its `Migration notes`. For a story, report its tabs, worksheet placement, unavailable worksheets, snapshot vs warehouse, each visible control migrated or skipped, and the final `Migration notes` tab when present.

## Guardrails

- Run only when the user explicitly requests a Tableau import, analysis, chart, or migration.
- When the user requests Tableau, use only data and metadata exported from that exact Tableau workbook or a verified warehouse source mapped from it. Never build the migration from an arbitrary local CSV or example database.
- Respect Tableau permissions; never ask for credentials in chat.
- Never read or expose Tableau credentials. The nao CLI owns authentication.
- Do not use Tableau MCP during this workflow.
- Use the nao CLI output for workbook composition and filter metadata; do not search for backend parser tools or infer the metadata from Tableau view names.
- Never fabricate dashboard membership.
- During a whole-workbook migration, import worksheets not used by any dashboard only as standalone tabs.
- During a dashboard-scoped migration, do not expand the request to other dashboards or unplaced worksheets.
- During worksheet delivery, create only the requested chart and do not create a story unless the user explicitly asks for one.
- Do not claim that a hidden, unpublished, or inaccessible worksheet was migrated; report why it was skipped.
- Never infer a worksheet's chart type from its name, CSV fields, or values. Verify it from that worksheet's Tableau view image before creating any nao artifact.
- Never aggregate away or discard a Tableau `lod`/Detail field that identifies individual marks.
- Never use spaces or punctuation in SQL aliases referenced by chart `data_key` values.
- Never silently replace an explicit Tableau series color with a default or black fallback.
- Never silently downgrade a Tableau chart to a table.
- Never invent a story filter or expose a hidden worksheet filter as a dashboard control.
- Do not claim pixel-identical reproduction.
- Treat imported view data as a snapshot, not a live sync.
- Do not migrate Tableau permissions, subscriptions, alerts, or user groups.
- Verify LOD expressions and context filters against Tableau numbers.
