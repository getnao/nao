---
name: migrate-tableau-workbook
description: Migrate a Tableau workbook into one nao story. Dashboards become tabs, and worksheets not used by any dashboard become standalone tabs. Use when the user asks to recreate, convert, or migrate a Tableau workbook, dashboard, or report. For a single worksheet, use import-tableau-worksheet. Requires a shell with the nao CLI and Tableau environment variables.
---

# migrate-tableau-workbook

Recreate a Tableau workbook as one nao story. Each dashboard becomes a tab containing its placed worksheets, and each worksheet not used by any dashboard becomes its own tab. If the workbook has no dashboards, create one tab per worksheet. Preserve analytical meaning and values; approximate layout and styling.

## When to use this skill

- User asks to migrate a workbook, dashboard, or Tableau report → this skill.
- User asks to import or chart one worksheet or view → `import-tableau-worksheet`.

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
- If the exact workbook cannot be resolved locally or through Tableau Cloud, stop and report that failure. Do not create a guessed or placeholder nao story.
- If the user named one dashboard, migrate only that dashboard. Do not add other dashboards or unplaced worksheets.
- If the user asked for the workbook, create one nao story containing every dashboard, every Tableau story point, and every worksheet not used by a dashboard or story point.
- Put each dashboard in its own tab. A worksheet used by several dashboards belongs in each of those dashboard tabs, but does not get an additional standalone tab.
- Flatten each Tableau story point into a top-level tab named `<story name> — <point caption>` because nao does not nest tabs. Use only the point's parsed source dashboard or worksheet and its captured state.
- Do not create a tab for Tableau's internal `flipboard` story container. It is not a dashboard and the parser excludes it from `dashboards`.
- Put each unplaced worksheet in its own tab after the dashboard and story-point tabs.
- If the workbook contains no dashboards or story points, create one tab per worksheet.

### 3. Get workbook migration metadata — do not guess

The CLI returns workbook composition, Tableau stories, worksheet visualization metadata, exported worksheet data, and source images. Inferring from workbook or view names caused wrong placement.

1. Choose a unique temporary JSON path and run:

```sh
nao migrate-tableau "<workbook-name-or-local-path>" --output "<temporary-migration-json-path>"
```

2. If the CLI reports duplicate workbook names, rerun it with the exact Tableau project:

```sh
nao migrate-tableau "<workbook-name>" --project "<project-name>" --output "<temporary-migration-json-path>"
```

3. Read the generated JSON file. Require `_version` to be `"2"` and `success` to be `true`; otherwise stop and report its `error`. Use `workbook.dashboards` for dashboard composition, `workbook.stories` for ordered story points and captured state, `workbook.worksheet_visualizations` for Tableau marks, shelves, encodings, colors, and formatting, `definition` for base worksheet filters, parameters, dashboard controls, worksheet targeting, and warnings, and `worksheet_assets` for exported CSV and image paths.
4. Require each migrated worksheet asset to have `success: true`, `data_path`, and `image_path`. Skip a failed worksheet and report its exact `data_error`, `image_error`, or `error`; do not fall back to Tableau MCP or guessed metadata.
5. Keep the migration JSON and `temporary_directory` until validation is complete, then delete both. They are temporary derived artifacts, not user deliverables.

| Tableau                           | nao                                                       |
| --------------------------------- | --------------------------------------------------------- |
| Workbook                          | One story                                                 |
| Dashboard                         | Story tab                                                 |
| Tableau story point               | Flattened story tab                                       |
| Worksheet not used by a dashboard | Standalone story tab                                     |
| Worksheet or view                 | Matching chart; table only for a source text table/crosstab |
| Published or embedded data source | Warehouse query when mapped; otherwise imported view data |
| Visible dashboard filter control  | Story filter when supported by the parser                 |
| Hidden worksheet filter           | Query constraint only; never a story control              |
| Parameter with allowed values     | Single-select control when its query behavior is reproducible |
| Free-form or range parameter      | Unsupported without a matching native story control       |
| Calculated field                  | SQL expression or documented metric                       |
| Marks card                        | Chart type and series encoding                            |
| Set, group, or bin                | SQL expression or lookup                                  |

Use only the `dashboards[].worksheets` lists the composition parser returns for dashboard membership. During a whole-workbook migration, treat `skipped_worksheets` as standalone worksheet tabs; when there are no dashboards, this includes every worksheet. Do not put those worksheets inside a dashboard tab. If an unplaced worksheet has no successful `worksheet_assets` entry, skip it and report the exact asset error instead of guessing or substituting another view. For a request scoped to one dashboard, ignore `skipped_worksheets`. The parser extracts explicit categorical filters and parameter definitions, but a control is reproducible only when the available data can implement its Tableau behavior.

### 4. Recreate each selected worksheet

For each unique worksheet on the selected dashboards and each exportable standalone worksheet, follow `import-tableau-worksheet`:

- Match each worksheet to its exact `worksheet_assets` entry.
- Before creating any nao file, query, chart, or story, read every selected worksheet's `image_path`. Complete this visual preflight for the whole migration first.
- Require a successful, readable image for every worksheet that will be migrated. If an image is unavailable, skip that worksheet and report its exact asset error; never infer its presentation from its name, CSV columns, values, dashboard image, or another worksheet.
- From each worksheet image, record the source presentation: chart or table, exact chart type, orientation, stacking or grouping, axes, measures, dimensions, color series, and visible labels. If nao has no exact equivalent, record the closest supported type and the specific approximation.
- Match that record against the worksheet's `worksheet_visualizations` entry. Use its mark type, rows, columns, encoding channels, stacking mode, explicit color assignments, and formatting as machine-readable evidence; if the XML metadata and image disagree, treat the image as authoritative and report the discrepancy.
- Treat an encoding with `channel: "lod"` as Tableau Detail: it identifies individual marks even when it is not drawn on an axis. Preserve every Detail field in the chart-ready query and use it as the point identity or tooltip label when nao supports that encoding. Never replace a Detail value with the numeric X-axis value.
- Treat a categorical `channel: "color"` field as a per-mark grouping dimension. Preserve its original values and colors. For scatter plots, keep Detail, Color, X, and Y fields in long-form rows; do not pivot the Color values into separate measure columns when that would discard the Detail field or remove Color from each point.
- If nao's supported chart configuration cannot expose a parsed Detail, Color, or tooltip field, keep the field in the query output and report that precise tooltip or encoding limitation. Do not silently drop the field or claim that the interaction matches Tableau.
- After completing the visual preflight, read each worksheet's exported CSV from `data_path`.
- Keep each CSV under `/home/tableau/<workbook-name>/`.
- Use `execute_sql` with `database_id: "duckdb_local"` for a chart-ready query ID.
- Alias every chart-ready SQL output column to a machine-safe lowercase snake-case identifier. Use human-readable labels in chart configuration instead of spaces or punctuation in `data_key`; unsafe keys can break series colors.
- Preserve explicit Tableau palette assignments from `worksheet_visualizations[].colors` whenever nao supports per-series colors. Never replace a readable Tableau color with black merely because a color could not be resolved.
- Build each query and chart from the recorded Tableau presentation, not from an inference based on the exported data. Preserve a Tableau chart as a chart; use a table only when the verified source worksheet is a text table/crosstab or the user explicitly requested a table.

Prefer an existing nao warehouse connection when the Tableau data source maps cleanly. Otherwise use the exported snapshot.

Until richer Tableau definition extractors exist, do not claim that calculated fields, context filters, LOD expressions, sets, groups, bins, marks, or formatting were reproduced from XML. Claim a parameter was reproduced only when its extracted definition, allowed values, target worksheets, and query behavior are all preserved. Preserve what can be verified from exported data and images, and list the rest as unsupported or approximated.

### 5. Convert supported filters automatically

Do this during every dashboard migration even when the user did not explicitly ask for filters.

For each dashboard, treat only entries in `definition.controls` whose `dashboard` exactly matches that dashboard as the allowlist of visible controls. `definition.filters` contains worksheet constraints and is not evidence that a filter was visible on the dashboard. `definition.parameters` contains definitions and is not evidence that a parameter control was visible. If that dashboard has no matching controls, create no story filters. Never infer controls from worksheet fields, CSV columns, captions, screenshots, common dashboard patterns, or filters from another dashboard.

Standalone worksheet tabs have no dashboard control allowlist. Preserve supported worksheet constraints in their queries, but create no story filters or parameter controls for them. Filter IDs must be unique across the entire story; when two dashboard tabs would use the same ID, prefix it with a filesystem-safe form of the dashboard name and update that dashboard's targeted queries accordingly.

Match each allowlisted control by type:

- For `type="filter"`, match its field and target worksheets to the extracted categorical filters. If the field is absent or the match is missing or ambiguous, skip it and report why.
- For `type="parameter"`, match its field and target worksheets to exactly one entry in `definition.parameters`. Never match a parameter control to a categorical filter or substitute a similarly named CSV column.

For a matched categorical filter:

1. Create a unique lowercase snake-case ID from the filter caption or field. IDs must start with a letter or underscore.
2. Use `type="multi_select"`. The extractor does not currently distinguish Tableau single-value and multiple-value controls.
3. Prefer `table`, `column`, and `database_id` when the Tableau field maps to a warehouse column. Otherwise use the extracted values as hardcoded `options`; report that these may not contain Tableau's complete domain.
4. Add the filter block inside the dashboard's story or tab:

```html
<filter id="region" label="Region" type="multi_select" options='["East","West"]' />
```

Update each targeted worksheet query in place with `execute_sql`, passing its existing `query_id`. Apply include filters with:

```sql
{% filter region %} AND region IN ({{ filters.region.sql }}) {% endfilter %}
```

Use `NOT IN` for an extracted exclude filter. Reference the filter only in queries for `target_worksheets`.

Do not create the filter when its field is absent from the query source. A pre-aggregated Tableau CSV often omits filter dimensions; use a mapped warehouse table or a sufficiently detailed export instead. Treat context filters as unsupported unless their ordering and aggregation semantics can be reproduced and verified.

For a matched parameter control:

1. Create a unique lowercase snake-case ID from its caption or field.
2. If `allowed_values` is non-empty and its behavior can be reproduced from the available data, use `type="select"` with exactly those values as `options`. Never invent or supplement parameter values.
3. Reproduce the parameter's semantics in SQL only for its `target_worksheets`. A metric selector must switch or filter the selected measure; a threshold parameter must apply a numeric comparison. Do not treat either as an ordinary categorical dimension filter.
4. If `allowed_values` is empty, the parameter requires arbitrary numeric/range input, or its query behavior cannot be reconstructed from the snapshot or warehouse, do not create it. Report that specific control as unsupported. Do not replace it with `search`, a customer filter, or guessed threshold options.

If the user later asks to add or fix filters, rerun `nao migrate-tableau` on the same downloaded workbook and use its `definition` as the same allowlist. A request for filters is not permission to invent controls that Tableau did not return.

### 6. Create the story

When the migration includes any interactive filters, require a valid nao `chat_id` before creating the story. Use the existing nao chat ID when one is available; otherwise obtain one from an `ask_nao` response. Pass that same `chat_id` to every `execute_sql` call and to `create_story`.

Do not create a standalone story with interactive filters. If no valid `chat_id` is available, stop and tell the user that interactive filters require a chat-linked nao story; do not create a standalone replacement and do not claim the filters work.

Run every required `execute_sql` call before `create_story`.

Use `create_story`:

- For a whole workbook, create exactly one story.
- When the story contains filters, pass its required `chat_id`.
- Add dashboard tabs first, in parser order. Each dashboard tab contains only the worksheets from that dashboard's parser result.
- Add flattened Tableau story-point tabs after dashboard tabs, preserving story and point order. A point sourced from a dashboard uses that dashboard's parsed layout and worksheets; a point sourced from a worksheet contains only that worksheet.
- When story points capture different filter or parameter state for the same source, create distinct query IDs for each state. Apply only the values returned on that point; never leak one point's state into another tab.
- Add one tab per exportable `skipped_worksheets` entry after the dashboard and story-point tabs. Each standalone tab contains only that worksheet.
- If there are no dashboards, create one tab per exportable worksheet.
- If the user requested one dashboard, create only that dashboard's story and do not add standalone worksheet tabs.
- A tabbed story must contain only `<tab>` blocks; put no headings, filters, charts, tables, or prose outside them.
- Follow `layout_rows` from top to bottom. Render a one-item row normally and a multi-item row as a `<grid>`; use zone widths as relative grid widths when available.
- Preserve dashboard and standalone worksheet names as tab titles, and worksheet names as chart titles. If tab names collide, add the smallest clear dashboard or worksheet suffix needed to distinguish them.
- Add every supported allowlisted dashboard control during the initial story creation. Add no other story filters.
- Generate a valid `<chart>` block with `display_chart` for every worksheet whose intended presentation is a chart, then embed that returned block in the story.
- Story updates replace the full content. Carry every existing valid chart block into each replacement unless deliberately regenerating that chart. Never substitute `<table>` for `<chart>` to work around a rendering, query, axis, series, or template problem; fix the problem and regenerate the chart block instead.
- Carry every valid `<filter>` block into each full-content replacement. Do not drop, rename, or add filters while troubleshooting unrelated story content.

Use `display_chart` to generate or validate chart blocks, but use the story as the final output of a workbook migration.

### 7. Validate and iterate

1. Compare totals, row counts, filters, and date ranges with Tableau.
2. Compare every chart or table with its required Tableau worksheet image and parsed visualization metadata. Correct chart type, orientation, stacking or grouping, axes, series, labels, and colors before finishing.
3. Select every migrated filter and confirm that only its targeted charts change. Treat unchanged charts, failed query refreshes, and “Chart data unavailable” as migration failures. Do not claim that making a story chat-linked fixed its filters without this verification.
4. Resolve every `template_warnings` result before finishing.
5. Fix data discrepancies before styling.
6. Update the existing story instead of creating duplicates.
7. After the final story update, compare its chart/table blocks with the recorded intended presentations. Do not finish if a source chart became a table or disappeared. Temporary diagnostic tables must not remain in the finished story.
8. Compare the final story's `<filter>` blocks with the supported allowlist for each dashboard. Do not finish with a missing allowlisted filter or any filter that was not returned as a dashboard control.
9. For a whole-workbook request, account for every parsed worksheet: it must appear in at least one dashboard tab, appear in a standalone tab, or be listed as skipped with a concrete access or export reason.

Finish with a migration summary: the story and tabs created, which worksheets landed on each dashboard tab, which unplaced worksheets became standalone tabs, any unavailable worksheets skipped with reasons, snapshot vs warehouse, each visible control migrated or skipped with its reason, and every unsupported or approximated feature. Do not use a blanket “parameters unsupported” note when some parameters were reproduced.

## Guardrails

- Run only when the user explicitly requests a Tableau migration.
- When the user requests Tableau, use only data and metadata exported from that exact Tableau workbook or a verified warehouse source mapped from it. Never build the migration from an arbitrary local CSV or example database.
- Respect Tableau permissions; never ask for credentials in chat.
- Never read or expose Tableau credentials. The nao CLI owns authentication.
- Do not use Tableau MCP during this workflow.
- Use the nao CLI output for workbook composition and filter metadata; do not search for backend parser tools or infer the metadata from Tableau view names.
- Never fabricate dashboard membership.
- During a whole-workbook migration, import worksheets not used by any dashboard only as standalone tabs.
- During a dashboard-scoped migration, do not expand the request to other dashboards or unplaced worksheets.
- Do not claim that a hidden, unpublished, or inaccessible worksheet was migrated; report why it was skipped.
- Never infer a worksheet's chart type from its name, CSV fields, or values. Verify it from that worksheet's Tableau view image before creating any nao artifact.
- Never aggregate away or discard a Tableau `lod`/Detail field that identifies individual marks.
- Never infer Tableau story-point order, source, or state. Use only `workbook.stories`.
- Never use spaces or punctuation in SQL aliases referenced by chart `data_key` values.
- Never silently replace an explicit Tableau series color with a default or black fallback.
- Never silently downgrade a Tableau chart to a table.
- Never invent a story filter or expose a hidden worksheet filter as a dashboard control.
- Do not claim pixel-identical reproduction.
- Treat imported view data as a snapshot, not a live sync.
- Do not migrate Tableau permissions, subscriptions, alerts, or user groups.
- Verify LOD expressions and context filters against Tableau numbers.
