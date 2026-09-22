import type { StoryFilterType } from './sql-template';
import type * as displayChart from './tools/display-chart';
import type * as displayMap from './tools/display-map';

export type { McpChartEmbedStoredConfig, McpMapEmbedStoredConfig } from './mcp-embed';

export function escapeDoubleQuotedStoryAttr(value: string): string {
	return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

export function escapeSingleQuotedStoryAttr(value: string): string {
	return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

export type StoryChartBlockInput = Pick<
	displayChart.KpiCardInput,
	| 'query_id'
	| 'chart_type'
	| 'x_axis_type'
	| 'x_axis_label'
	| 'series'
	| 'y_axis_min'
	| 'y_axis_max'
	| 'y_axis_label'
	| 'y_axis_right_min'
	| 'y_axis_right_max'
	| 'y_axis_right_label'
	| 'show_data_labels'
	| 'comparison_mode'
	| 'hide_total'
> & {
	title?: displayChart.KpiCardInput['title'];
	x_axis_key?: displayChart.KpiCardInput['x_axis_key'];
};

export function buildStoryChartBlock(input: StoryChartBlockInput): string {
	const xAxisKeyAttr = input.x_axis_key ? ` x_axis_key="${escapeDoubleQuotedStoryAttr(input.x_axis_key)}"` : '';
	const xAxisTypeAttr =
		input.x_axis_type != null ? ` x_axis_type="${escapeDoubleQuotedStoryAttr(input.x_axis_type)}"` : '';
	const xLabelAttr = input.x_axis_label ? ` x_axis_label="${escapeDoubleQuotedStoryAttr(input.x_axis_label)}"` : '';
	const yMinAttr = input.y_axis_min !== undefined ? ` y_axis_min="${input.y_axis_min}"` : '';
	const yMaxAttr = input.y_axis_max !== undefined ? ` y_axis_max="${input.y_axis_max}"` : '';
	const yLabelAttr = input.y_axis_label ? ` y_axis_label="${escapeDoubleQuotedStoryAttr(input.y_axis_label)}"` : '';
	const yRightMinAttr = input.y_axis_right_min !== undefined ? ` y_axis_right_min="${input.y_axis_right_min}"` : '';
	const yRightMaxAttr = input.y_axis_right_max !== undefined ? ` y_axis_right_max="${input.y_axis_right_max}"` : '';
	const yRightLabelAttr = input.y_axis_right_label
		? ` y_axis_right_label="${escapeDoubleQuotedStoryAttr(input.y_axis_right_label)}"`
		: '';
	const seriesJson = escapeSingleQuotedStoryAttr(JSON.stringify(input.series));
	const titleAttr =
		input.title != null && input.title !== '' ? ` title="${escapeDoubleQuotedStoryAttr(input.title)}"` : '';
	const dataLabelsAttr = input.show_data_labels ? ' show_data_labels="true"' : '';
	const comparisonModeAttr =
		input.comparison_mode && input.comparison_mode !== 'none'
			? ` comparison_mode="${escapeDoubleQuotedStoryAttr(input.comparison_mode)}"`
			: '';
	const hideTotalAttr = input.hide_total ? ' hide_total="true"' : '';
	return `<chart query_id="${escapeDoubleQuotedStoryAttr(input.query_id)}" chart_type="${escapeDoubleQuotedStoryAttr(input.chart_type)}"${xAxisKeyAttr}${xAxisTypeAttr}${xLabelAttr}${yMinAttr}${yMaxAttr}${yLabelAttr}${yRightMinAttr}${yRightMaxAttr}${yRightLabelAttr} series='${seriesJson}'${titleAttr}${dataLabelsAttr}${comparisonModeAttr}${hideTotalAttr} />`;
}

export type StoryTableBlockInput = Pick<displayChart.TableInput, 'query_id' | 'title' | 'conditional_formats'>;

export function buildStoryTableBlock(input: StoryTableBlockInput): string {
	const titleAttr =
		input.title != null && input.title !== '' ? ` title="${escapeDoubleQuotedStoryAttr(input.title)}"` : '';
	const formattingAttr =
		input.conditional_formats && Object.keys(input.conditional_formats).length > 0
			? ` formatting='${escapeSingleQuotedStoryAttr(JSON.stringify(input.conditional_formats))}'`
			: '';
	return `<table query_id="${escapeDoubleQuotedStoryAttr(input.query_id)}"${titleAttr}${formattingAttr} />`;
}

export type StoryMapBlockInput = Pick<
	displayMap.Input,
	| 'query_id'
	| 'map_type'
	| 'latitude_key'
	| 'longitude_key'
	| 'label_key'
	| 'tooltip_keys'
	| 'color'
	| 'radius'
	| 'size_key'
	| 'value_key'
	| 'region_key'
	| 'region_boundaries'
	| 'boundaries_url'
	| 'boundaries_join_property'
	| 'geometry_key'
	| 'title'
>;

export function buildStoryMapBlock(input: StoryMapBlockInput): string {
	const stringAttr = (name: string, value: string | undefined) =>
		value ? ` ${name}="${escapeDoubleQuotedStoryAttr(value)}"` : '';
	const tooltipAttr =
		input.tooltip_keys && input.tooltip_keys.length > 0
			? ` tooltip_keys='${escapeSingleQuotedStoryAttr(JSON.stringify(input.tooltip_keys))}'`
			: '';
	const radiusAttr = input.radius !== undefined ? ` radius="${input.radius}"` : '';
	const titleAttr =
		input.title != null && input.title !== '' ? ` title="${escapeDoubleQuotedStoryAttr(input.title)}"` : '';
	return (
		`<map query_id="${escapeDoubleQuotedStoryAttr(input.query_id)}" map_type="${escapeDoubleQuotedStoryAttr(input.map_type)}"` +
		stringAttr('latitude_key', input.latitude_key) +
		stringAttr('longitude_key', input.longitude_key) +
		stringAttr('label_key', input.label_key) +
		tooltipAttr +
		stringAttr('color', input.color) +
		radiusAttr +
		stringAttr('size_key', input.size_key) +
		stringAttr('value_key', input.value_key) +
		stringAttr('region_key', input.region_key) +
		stringAttr('region_boundaries', input.region_boundaries) +
		stringAttr('boundaries_url', input.boundaries_url) +
		stringAttr('boundaries_join_property', input.boundaries_join_property) +
		stringAttr('geometry_key', input.geometry_key) +
		titleAttr +
		' />'
	);
}

export interface StoryFilterBlockInput {
	id: string;
	column?: string;
	label?: string;
	type: StoryFilterType;
	table?: string;
	database_id?: string;
	options?: string[];
}

export function buildStoryFilterBlock(input: StoryFilterBlockInput): string {
	const labelAttr = input.label ? ` label="${escapeDoubleQuotedStoryAttr(input.label)}"` : '';
	const columnAttr = input.column ? ` column="${escapeDoubleQuotedStoryAttr(input.column)}"` : '';
	const tableAttr = input.table ? ` table="${escapeDoubleQuotedStoryAttr(input.table)}"` : '';
	const databaseIdAttr = input.database_id ? ` database_id="${escapeDoubleQuotedStoryAttr(input.database_id)}"` : '';
	const optionsAttr = input.options ? ` options='${escapeSingleQuotedStoryAttr(JSON.stringify(input.options))}'` : '';
	return `<filter id="${escapeDoubleQuotedStoryAttr(input.id)}"${columnAttr}${labelAttr} type="${input.type}"${tableAttr}${databaseIdAttr}${optionsAttr} />`;
}
