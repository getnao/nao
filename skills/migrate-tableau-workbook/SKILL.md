---
name: migrate-tableau-workbook
description: Migrate Tableau dashboards into nao stories. Each dashboard becomes a story or a story tab; only worksheets placed on those dashboards are imported. Use when the user asks to recreate, convert, or migrate a Tableau workbook, dashboard, or report. For a single worksheet, use import-tableau-worksheet. Requires a configured Tableau MCP server.
---

# migrate-tableau-workbook

Recreate Tableau **dashboards** as nao stories. A workbook can contain many leftover worksheets; do not import those. Preserve analytical meaning and values; approximate layout and styling.

## When to use this skill

- User asks to migrate a workbook, dashboard, or Tableau report → this skill.
- User asks to import or chart one worksheet or view → `import-tableau-worksheet`.

## Workflow

### 1. Find the Tableau MCP tools

Find the configured Tableau server under `/agent/mcps/`. If its folder is empty, connect to it before continuing.

If no Tableau server is configured or a call fails, report the actual connection or authentication error. Do not assume the user needs an OAuth connection because Tableau MCP may use server-side credentials.

Read the discovered tool specifications before calling them; do not assume argument names.

### 2. Resolve which dashboards to migrate

Use the supplied workbook or view ID when available. Otherwise find the workbook, then read it.

- If the user named one dashboard, migrate only that dashboard.
- If the user asked for the workbook, migrate every **dashboard**. Do not migrate worksheets that are not on a dashboard.
- Prefer one nao story per dashboard. If the user wants the workbook kept together and there are only a few dashboards, one story with a tab per dashboard is fine.

### 3. Get dashboard composition — do not guess

Tableau's `get-workbook` / `list-views` lists views. It does not say which worksheets sit on which dashboard. Inferring from names caused wrong placement.

1. Download the workbook with `download-workbook` when that tool exists (`includeExtract: false` is enough). Prefer TWB XML. Save a file under `/home/tableau/` when the download is a `.twb` / `.twbx`.
2. Call `parse_tableau_workbook` with exactly one of `file_path`, `workbook_xml`, or `workbook_base64`. If the user named one dashboard, pass `dashboard` too.
3. Call `parse_tableau_filters` with the same workbook input and dashboard.
4. If the workbook file cannot be obtained or parsed, stop. Create nothing from guessed membership.

| Tableau                           | nao                                                       |
| --------------------------------- | --------------------------------------------------------- |
| Dashboard                         | Story or story tab                                        |
| Worksheet or view                 | Chart or table                                            |
| Published or embedded data source | Warehouse query when mapped; otherwise imported view data |
| Parameter or user-facing filter   | Story filter when supported                               |
| Calculated field                  | SQL expression or documented metric                       |
| Marks card                        | Chart type and series encoding                            |
| Set, group, or bin                | SQL expression or lookup                                  |

Use only the `dashboards[].worksheets` lists the composition parser returns. `skipped_worksheets` are leftover sheets — mention them, do not import them. Filter extraction currently supports explicit categorical filters; it does not reproduce parameters or other Tableau filter types.

### 4. Recreate each dashboard worksheet

For each worksheet on the selected dashboards, follow `import-tableau-worksheet`:

- Resolve the view LUID. Call `get-view-data` on the **worksheet** view, not the dashboard view.
- Keep the CSV under `/home/tableau/<workbook-name>/`.
- Use `execute_sql` with `database_id: "duckdb_local"` for a chart-ready query ID.
- Infer the closest nao chart from the exported fields, values, and Tableau view image.

Prefer an existing nao warehouse connection when the Tableau data source maps cleanly. Otherwise use the exported snapshot.

Until richer Tableau definition extractors exist, do not claim that calculated fields, parameters, context filters, LOD expressions, sets, groups, bins, marks, or formatting were reproduced from XML. Preserve what can be verified from exported data and images, and list the rest as unsupported or approximated.

### 5. Convert supported filters

Create a story filter only for a returned dashboard control that resolves to an extracted categorical filter. Do not turn hidden worksheet filters into interactive controls.

For each supported control:

1. Match its `field` and `target_worksheets` to the extracted filter.
2. Create a unique lowercase snake-case ID from the filter caption or field. IDs must start with a letter or underscore.
3. Use `type="multi_select"`. The extractor does not currently distinguish Tableau single-value and multiple-value controls.
4. Prefer `table`, `column`, and `database_id` when the Tableau field maps to a warehouse column. Otherwise use the extracted values as hardcoded `options`; report that these may not contain Tableau's complete domain.
5. Add the filter block inside the dashboard's story or tab:

```html
<filter id="region" label="Region" type="multi_select" options='["East","West"]' />
```

Update each targeted worksheet query in place with `execute_sql`, passing its existing `query_id`. Apply include filters with:

```sql
{% filter region %} AND region IN ({{ filters.region.sql }}) {% endfilter %}
```

Use `NOT IN` for an extracted exclude filter. Reference the filter only in queries for `target_worksheets`.

Do not create the filter when its field is absent from the query source. A pre-aggregated Tableau CSV often omits filter dimensions; use a mapped warehouse table or a sufficiently detailed export instead. Treat context filters as unsupported unless their ordering and aggregation semantics can be reproduced and verified.

### 6. Create the story

Run every required `execute_sql` call first.

Use the `story` tool:

- One story per dashboard, or one story with a `<tab>` per dashboard when keeping the workbook together.
- Each tab or story contains only the worksheets from that dashboard's parser result.
- Follow `layout_rows` from top to bottom. Render a one-item row normally and a multi-item row as a `<grid>`; use zone widths as relative grid widths when available.
- Preserve dashboard names as titles and worksheet titles as chart titles.
- Add story filters only when the Tableau filter or parameter can be preserved.

Do not use `display_chart` as the final output of a dashboard migration.

### 7. Validate and iterate

1. Compare totals, row counts, filters, and date ranges with Tableau.
2. Compare charts with a Tableau view image when available.
3. Select every migrated filter and confirm that only its targeted charts change.
4. Resolve every `template_warnings` result before finishing.
5. Fix data discrepancies before styling.
6. Update the existing story instead of creating duplicates.

Finish with a migration summary: stories and tabs created, which worksheets landed on which dashboard, leftover sheets skipped, snapshot vs warehouse, and every unsupported or approximated feature.

## Guardrails

- Run only when the user explicitly requests a Tableau migration.
- Respect Tableau permissions; never ask for credentials in chat.
- Never fabricate dashboard membership.
- Do not import worksheets that are not on a migrated dashboard.
- Do not claim pixel-identical reproduction.
- Treat imported view data as a snapshot, not a live sync.
- Do not migrate Tableau permissions, subscriptions, alerts, or user groups.
- Verify LOD expressions and context filters against Tableau numbers.
