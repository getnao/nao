import type * as displayChart from './tools/display-chart';
import type * as displayTable from './tools/display-table';

export type { McpChartEmbedStoredConfig } from './mcp-embed';

export function escapeDoubleQuotedStoryAttr(value: string): string {
	return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

export function escapeSingleQuotedStoryAttr(value: string): string {
	return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

export type StoryChartBlockInput = Pick<
	displayChart.Input,
	'query_id' | 'chart_type' | 'x_axis_key' | 'x_axis_type' | 'series'
> & {
	title?: displayChart.Input['title'];
};

export function buildStoryChartBlock(input: StoryChartBlockInput): string {
	const xAxisTypeAttr =
		input.x_axis_type != null ? ` x_axis_type="${escapeDoubleQuotedStoryAttr(input.x_axis_type)}"` : '';
	const seriesJson = escapeSingleQuotedStoryAttr(JSON.stringify(input.series));
	const titleAttr =
		input.title != null && input.title !== '' ? ` title="${escapeDoubleQuotedStoryAttr(input.title)}"` : '';
	return `<chart query_id="${escapeDoubleQuotedStoryAttr(input.query_id)}" chart_type="${escapeDoubleQuotedStoryAttr(input.chart_type)}" x_axis_key="${escapeDoubleQuotedStoryAttr(input.x_axis_key)}"${xAxisTypeAttr} series='${seriesJson}'${titleAttr} />`;
}

export type StoryTableBlockInput = Pick<displayTable.Input, 'query_id' | 'title' | 'conditional_formats'>;

export function buildStoryTableBlock(input: StoryTableBlockInput): string {
	const titleAttr =
		input.title != null && input.title !== '' ? ` title="${escapeDoubleQuotedStoryAttr(input.title)}"` : '';
	const formattingAttr =
		input.conditional_formats && Object.keys(input.conditional_formats).length > 0
			? ` formatting='${escapeSingleQuotedStoryAttr(JSON.stringify(input.conditional_formats))}'`
			: '';
	return `<table query_id="${escapeDoubleQuotedStoryAttr(input.query_id)}"${titleAttr}${formattingAttr} />`;
}
