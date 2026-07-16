import type * as displayChart from './tools/display-chart';

export type { McpChartEmbedStoredConfig } from './mcp-embed';

export function escapeDoubleQuotedStoryAttr(value: string): string {
	return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

export function escapeSingleQuotedStoryAttr(value: string): string {
	return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

export type StoryChartBlockInput = Pick<
	displayChart.Input,
	| 'query_id'
	| 'chart_type'
	| 'x_axis_key'
	| 'x_axis_type'
	| 'series'
	| 'y_axis_min'
	| 'y_axis_max'
	| 'show_data_labels'
> & {
	title?: displayChart.Input['title'];
};

export function buildStoryChartBlock(input: StoryChartBlockInput): string {
	const xAxisTypeAttr =
		input.x_axis_type != null ? ` x_axis_type="${escapeDoubleQuotedStoryAttr(input.x_axis_type)}"` : '';
	const yMinAttr = input.y_axis_min !== undefined ? ` y_axis_min="${input.y_axis_min}"` : '';
	const yMaxAttr = input.y_axis_max !== undefined ? ` y_axis_max="${input.y_axis_max}"` : '';
	const seriesJson = escapeSingleQuotedStoryAttr(JSON.stringify(input.series));
	const titleAttr =
		input.title != null && input.title !== '' ? ` title="${escapeDoubleQuotedStoryAttr(input.title)}"` : '';
	const dataLabelsAttr = input.show_data_labels ? ' show_data_labels="true"' : '';
	return `<chart query_id="${escapeDoubleQuotedStoryAttr(input.query_id)}" chart_type="${escapeDoubleQuotedStoryAttr(input.chart_type)}" x_axis_key="${escapeDoubleQuotedStoryAttr(input.x_axis_key)}"${xAxisTypeAttr}${yMinAttr}${yMaxAttr} series='${seriesJson}'${titleAttr}${dataLabelsAttr} />`;
}
