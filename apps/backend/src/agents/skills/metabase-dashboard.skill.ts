import type { InternalSkill } from './types';

const PLAYBOOK = `# Metabase dashboard to story

Use the configured \`metabase\` MCP server for discovery and execution, and the read-only \`get_metabase_dashboard_metadata\` tool for presentation metadata. Keep Metabase read-only.

## Never fabricate an import

Do not create or update a story until you have successfully read the requested dashboard from Metabase. If the server is unavailable, authentication is required, or the dashboard cannot be resolved unambiguously, stop and tell the user. Never substitute a generic dashboard, checklist, placeholder values, or inferred source content.

## Read the source

1. If \`/agent/mcps/metabase/\` is missing or empty, call \`mcp_connect\` with server \`metabase\`.
2. Read the generated \`read_resource\` and \`execute_question\` specifications before calling them. If OAuth is required, stop and ask the user to connect.
3. Resolve the dashboard from a numeric ID or a Metabase dashboard URL. For a name, read \`metabase://collections?tree=true\`, then each relevant \`metabase://collection/<id>/items\` page until one visible dashboard matches. Ask when no dashboard or several dashboards match.
4. Call \`get_metabase_dashboard_metadata\` with the resolved dashboard ID. This is the source of truth for tabs, text cards, repeated placements, display types, visualization settings, filters, and layout. Stop rather than creating a guess if this call fails.
5. Use each primary card's and linked series' \`effectiveFilterIds\` from dashboard metadata; each list contains only filters explicitly mapped to that question and is empty for unwired questions. Group questions by ID and this effective filter set, process each unique combination once, and reuse its nao query ID only for repeated placements with the same effective filters.
6. For a parameterless native question, use the returned \`nativeSql\` directly and do not call \`read_resource\` or \`execute_question\` for that question.
7. For each primary or linked-series non-native or reusable question, batch up to five \`metabase://question/<id>\` URIs in one \`read_resource\` call. Call \`execute_question\` once only when compiled SQL is required. Read \`metabase://question/<id>/fields\` only when neither metadata nor the nao query result identifies the columns needed for an explicit visualization setting.
8. A card with a \`questionId\` but a null \`question\` has metadata the caller cannot read. Skip that card and report it as inaccessible instead of failing the whole dashboard migration.

Follow pagination metadata and send no more than five URIs in one \`read_resource\` call.

## Build the story

- Use the source dashboard name and description for the title and introduction.
- Preserve virtual text cards as Markdown. Preserve repeated placements of a question and every linked series in source order.
- Use the card's native SQL or the compiled read-only SQL returned by execution only when exactly one nao database is an unambiguous match. Run it with \`execute_sql\`; every chart or table must use the resulting nao query ID. Never guess the database mapping or embed copied Metabase rows as chart data.
- For native SQL template tags, replace mapped Metabase optional clauses with nao filter blocks before execution. A direct \`column = {{tag}}\` clause can become \`{% filter tag %} AND column = {{ filters.tag.sql }} {% endfilter %}\`.
- Treat a question whose type is \`model\` or \`metric\`, or whose \`sourceTable\` references another card, as a reusable Metabase object. Preserve execution by inlining only Metabase-provided SQL, label its provenance in the story report, and never claim it was recreated as a reusable nao semantic object.
- Derive axis and series keys from the nao query result, then call \`display_chart\` before embedding each chart.
- Translate Metabase displays to nao displays:
  - \`scalar\` and \`smartscalar\` → \`kpi_card\`.
  - \`line\` → \`line\`.
  - \`bar\` → \`bar\`, \`stacked_bar\`, or \`stacked_bar_100\` according to \`stackable.stack_type\`.
  - \`row\` → \`horizontal_bar\` or \`horizontal_bar_100\`.
  - \`area\` → \`area\`, \`stacked_area\`, or \`stacked_area_100\`.
  - \`combo\` → \`mixed\`, preserving explicit bar, line, or area series and left/right axes.
  - \`pie\` → \`pie\` or \`donut\` according to its settings.
  - \`scatter\` and \`radar\` → the matching nao chart when their required numeric columns exist.
  - \`gauge\` → \`gauge\` with exactly one metric and the ordered numeric \`gauge.segments\` ranges, preserving each range's color and optional label. Apply the selected column's value format to the value and range boundaries. Report query-driven range boundaries as unsupported.
  - \`table\` → \`table\`.
  - \`map\` → \`display_map\` only when valid point or supported-region columns are explicit.
- Preserve supported titles, labels, colors, value formats, axis bounds, data-label visibility, and KPI comparison settings. Report settings nao cannot represent.
- Sort tabs by position and cards within each tab by row then column. Group cards sharing a source row into \`<grid>\` blocks and derive relative \`widths\` from \`size_x\`; this preserves reading order and approximate proportions rather than pixels.
- Preserve each dashboard filter only when the story tool documents a matching filter type. Create every supported dashboard filter mapped to at least one card without waiting for the user to ask for more filters, even when different filters target different subsets of cards. During Metabase dashboard migration only, apply the filters listed in each card's \`effectiveFilterIds\`; keep cards whose list is empty completely unfiltered. Use \`parameterMappings\` for the original Metabase targets and never infer a mapping from another card in the same tab. Place each \`<filter>\` declaration only inside tabs containing a successfully translated target card.
- A Metabase filter \`default\` is the current selection, never its complete option list. Do not turn a default such as \`Electronics\` into hardcoded options or invent fallback values such as \`Other\`.
- For a Metabase exact string filter whose native SQL clearly identifies \`table.column = {{tag}}\`, default to a nao \`multi_select\` filter with that target table, column, and nao database ID so options come from distinct live values, and translate the clause to \`table.column IN ({{ filters.tag.sql }})\`. Apply this default only during Metabase dashboard migration and follow the explicit-or-compatible card rules above. Use \`search\` only when partial matching is intended and change the SQL operator to \`LIKE\`. If the option source or SQL wiring cannot be translated exactly, leave the filter inactive and report it instead of applying it globally.
- Call the \`story\` tool with action \`create\` only after reading all accessible dashboard items.
- End with a \`Source limitations\` section listing everything unavailable or unsuccessful.

## Fidelity limits

Nao does not support every Metabase visualization or interaction. Do not silently replace unsupported displays with a table: identify the source card and either use a named approximation accepted by the user or report it as skipped. Parameterized questions may fail through the official MCP; report each failure and continue with the remaining questions. Never claim pixel-perfect equivalence.`;

export const metabaseDashboardSkill: InternalSkill = {
	name: 'metabase-dashboard',
	description:
		'Mandatory workflow for importing, migrating, copying, or replicating a Metabase dashboard or collection as a nao story. Load this before responding to any Metabase-to-story request.',
	body: () => PLAYBOOK,
};
