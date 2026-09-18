import { displayChart } from '@nao/shared/tools';

const MAX_INLINE_ROWS = 500;
const MAX_INLINE_DATA_CHARS = 80_000;

const DISPLAY_CHART_RETURNS =
	'it returns the chart config and data rows with rendering instructions so you can render the chart ' +
	'yourself as an interactive visualization (e.g. a recharts component in a code frame)';

export const CHART_DATA_MODE_SERVER_INSTRUCTIONS =
	' Chart workflow: when `ask_nao` returns `queries`, call `display_chart` with a `query_id` — ' +
	`${DISPLAY_CHART_RETURNS} — do not just relay the embed link.`;

export const CHART_DATA_MODE_ASK_NAO_ADDENDUM =
	'\n\nCHARTS: when the result carries `queries` worth visualizing, follow up with `display_chart` on a ' +
	`\`queries[].id\` — ${DISPLAY_CHART_RETURNS}.`;

export const CHART_DATA_MODE_DISPLAY_CHART_ADDENDUM =
	'\n\nRENDERING: when the result includes the chart config, the data rows and recharts mapping instructions ' +
	'and your platform can render code-based visualizations (React frames, artifacts, canvases…), render the ' +
	'chart yourself as an interactive component from them instead of only sharing the embed link.';

export const CHART_DATA_MODE_RESULT_NUDGE =
	'If a visualization would help answer the question, call `display_chart` with a `query_id` from `queries` — ' +
	`${DISPLAY_CHART_RETURNS}.`;

export const CHART_DATA_MODE_FALLBACK_NOTE =
	'Chart data not inlined (custom chart type, empty result, or too many rows to inline) — ' +
	'share the embed link from this result instead of rendering the chart yourself.';

const RENDER_INSTRUCTIONS = [
	'RENDER THIS CHART for the user as an interactive visualization — do not answer with only links or a text list of the numbers. If your platform can render code-based visualizations (Dust interactive frames, Claude artifacts, canvases, React components…), build a single self-contained `recharts` component from the config and data below, inlining the data as a literal constant — never fetch it over the network. Only fall back to sharing the embed links from this result if no such rendering capability exists.',
	'- Config mapping: `chart_type` → recharts component (`bar`→BarChart, `line`→LineChart, `area`→AreaChart, `pie`/`donut`→PieChart, `scatter`→ScatterChart, `radar`→RadarChart, `mixed`→ComposedChart with per-series `series_type`, `stacked_*`→shared `stackId`, `*_100`→stackOffset="expand", `kpi_card`→a stat card without a chart, `table`→a plain table).',
	'- `x_axis_key` → XAxis dataKey (for `pie`/`donut` → `Pie` nameKey; for `radar` → PolarAngleAxis dataKey); each `series[].data_key` → one mark (Bar/Line/Area/…) with its `color` and `label`; `value_format` hints number formatting; `y_axis: "right"` → secondary YAxis.',
	'- Omit series with `is_total: true` from `*_100` stacks — a pre-aggregated total would skew the percentages; render them normally in every other chart type.',
	'- Respect the series colors. Add a Tooltip, and a Legend when there are multiple series.',
	'- Along with the rendered chart, always include the `Open in nao` link from this result so the user can explore the underlying analysis in nao.',
].join('\n');

export function buildAgentRenderedChartText(args: {
	config: displayChart.ChartInput;
	columns: string[];
	rows: Record<string, unknown>[];
}): string | null {
	const { config, columns, rows } = args;
	if (!displayChart.isNativeDisplayType(config.chart_type) || rows.length === 0 || rows.length > MAX_INLINE_ROWS) {
		return null;
	}

	const dataJson = JSON.stringify(rows);
	if (dataJson.length > MAX_INLINE_DATA_CHARS) {
		return null;
	}

	const { query_id: _queryId, ...renderConfig } = config;
	return [
		RENDER_INSTRUCTIONS,
		'',
		`Chart config: ${JSON.stringify(renderConfig)}`,
		'',
		`Data (${rows.length} rows, columns: ${columns.join(', ')}): ${dataJson}`,
	].join('\n');
}
