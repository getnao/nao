import { labelize } from '@nao/shared/chart-builder';
import { isNumericColumn } from './columns';
import { toChartValueFormat } from './format';
import type { ChartType } from '@nao/shared/chart-types';
import type {
	StoryBlockChartConfig,
	StoryKitBlockRef,
	StoryKitChartBlock,
	StoryKitEditableBlock,
} from '@nao/shared/story-app';
import type { displayChart } from '@nao/shared/tools';

import type { Row } from './columns';
import type { FormatOptions } from './format';

export type SeriesInput =
	| string
	| {
			key: string;
			label?: string;
			color?: string;
			valueFormat?: displayChart.ValueFormat;
			isTotal?: boolean;
			type?: displayChart.SeriesType;
			axis?: displayChart.YAxisSide;
	  };

export type SeriesSpec = Exclude<SeriesInput, string>;

export interface ChartAxisProps {
	xAxisType?: displayChart.XAxisType;
	xAxisLabel?: string;
	yAxisMin?: number;
	yAxisMax?: number;
	yAxisLabel?: string;
	yAxisRightMin?: number;
	yAxisRightMax?: number;
	yAxisRightLabel?: string;
}

export interface ChartOptions extends ChartAxisProps, FormatOptions {
	xKey?: string;
	series?: SeriesInput[];
	showDataLabels?: boolean;
	hideTotal?: boolean;
}

export interface ResolvedChart {
	xAxisKey: string;
	series: SeriesSpec[];
}

export interface KitBlockElement {
	component: StoryKitChartBlock;
	props: Record<string, unknown>;
}

export function blockRef<Component extends StoryKitEditableBlock>(
	component: Component,
	props: object,
): StoryKitBlockRef & { component: Component } {
	return { component, props: { ...props } };
}

export function resolveChart(
	rows: Row[],
	columns: string[],
	{ xKey, series }: ChartOptions,
	chartType?: ChartType,
): ResolvedChart {
	const xAxisKey = chartType === 'scatter' ? (xKey ?? columns[0]) : resolveXKey(rows, columns, xKey);
	const inputs = series ?? columns.filter((column) => column !== xAxisKey && isNumericColumn(rows, column));
	return { xAxisKey, series: inputs.map(toSeriesSpec) };
}

export function resolveXKey(rows: Row[], columns: string[], xKey?: string): string {
	return xKey ?? columns.find((column) => !isNumericColumn(rows, column)) ?? columns[0];
}

export function toSeriesConfigs(series: SeriesSpec[], options: FormatOptions): displayChart.SeriesConfig[] {
	const chartFormat = toChartValueFormat(options);
	return series.map((spec) =>
		withoutUndefined({
			data_key: spec.key,
			label: spec.label,
			color: spec.color,
			value_format: spec.valueFormat ?? chartFormat,
			is_total: spec.isTotal,
			series_type: spec.type,
			y_axis: spec.axis,
		}),
	);
}

export function barChartType(stacked: boolean, horizontal: boolean, percent: boolean): ChartType {
	if (horizontal) {
		return percent ? 'horizontal_bar_100' : 'horizontal_bar';
	}
	if (stacked) {
		return percent ? 'stacked_bar_100' : 'stacked_bar';
	}
	return 'bar';
}

export function lineChartType(area: boolean, stacked: boolean, percent: boolean): ChartType {
	if (stacked) {
		return percent ? 'stacked_area_100' : 'stacked_area';
	}
	return area ? 'area' : 'line';
}

export function chartBlockConfig(
	chartType: ChartType,
	queryId: string | undefined,
	title: string | undefined,
	resolved: ResolvedChart,
	options: ChartOptions,
): StoryBlockChartConfig {
	return withoutUndefined({
		query_id: queryId ?? '',
		chart_type: chartType,
		title: title ?? '',
		x_axis_key: resolved.xAxisKey,
		x_axis_type: options.xAxisType ?? null,
		x_axis_label: options.xAxisLabel,
		series: toSeriesConfigs(resolved.series, options),
		y_axis_min: options.yAxisMin,
		y_axis_max: options.yAxisMax,
		y_axis_label: options.yAxisLabel,
		y_axis_right_min: options.yAxisRightMin,
		y_axis_right_max: options.yAxisRightMax,
		y_axis_right_label: options.yAxisRightLabel,
		show_data_labels: options.showDataLabels,
		hide_total: options.hideTotal,
	});
}

export function kpiBlockConfig(
	queryId: string | undefined,
	title: string | undefined,
	value: { key: string; label?: string; valueFormat?: displayChart.ValueFormat },
	xAxisKey: string,
	comparison: displayChart.ComparisonMode | undefined,
): StoryBlockChartConfig {
	return withoutUndefined({
		query_id: queryId ?? '',
		chart_type: 'kpi_card',
		title: title ?? '',
		x_axis_key: xAxisKey,
		x_axis_type: null,
		series: [withoutUndefined({ data_key: value.key, label: value.label, value_format: value.valueFormat })],
		comparison_mode: comparison,
	});
}

export function kitBlockFromConfig(config: StoryBlockChartConfig): KitBlockElement {
	if (config.chart_type === 'kpi_card') {
		const [value] = config.series;
		return {
			component: 'KpiCard',
			props: withoutUndefined({
				title: config.title || undefined,
				valueKey: value?.data_key,
				label: value?.label,
				valueFormat: value?.value_format,
				xKey: config.x_axis_key || undefined,
				comparison: config.comparison_mode,
			}),
		};
	}
	const { component, props } = presetForChartType(config.chart_type);
	return {
		component,
		props: withoutUndefined({
			...props,
			title: config.title || undefined,
			xKey: config.x_axis_key,
			xAxisType: config.x_axis_type ?? undefined,
			xAxisLabel: config.x_axis_label,
			series: config.series.map(toSeriesInput),
			yAxisMin: config.y_axis_min,
			yAxisMax: config.y_axis_max,
			yAxisLabel: config.y_axis_label,
			yAxisRightMin: config.y_axis_right_min,
			yAxisRightMax: config.y_axis_right_max,
			yAxisRightLabel: config.y_axis_right_label,
			showDataLabels: config.show_data_labels,
			hideTotal: config.hide_total,
		}),
	};
}

function presetForChartType(chartType: ChartType): KitBlockElement {
	switch (chartType) {
		case 'bar':
			return { component: 'BarChart', props: {} };
		case 'stacked_bar':
			return { component: 'BarChart', props: { stacked: true } };
		case 'stacked_bar_100':
			return { component: 'BarChart', props: { stacked: true, percent: true } };
		case 'horizontal_bar':
			return { component: 'BarChart', props: { horizontal: true } };
		case 'horizontal_bar_100':
			return { component: 'BarChart', props: { horizontal: true, percent: true } };
		case 'line':
			return { component: 'LineChart', props: {} };
		case 'area':
			return { component: 'LineChart', props: { area: true } };
		case 'stacked_area':
			return { component: 'LineChart', props: { stacked: true } };
		case 'stacked_area_100':
			return { component: 'LineChart', props: { stacked: true, percent: true } };
		default:
			return { component: 'Chart', props: { type: chartType } };
	}
}

function toSeriesSpec(input: SeriesInput): SeriesSpec {
	return typeof input === 'string' ? { key: input } : input;
}

function toSeriesInput(series: displayChart.SeriesConfig): SeriesInput {
	const spec: SeriesSpec = withoutUndefined({
		key: series.data_key,
		label: series.label && series.label !== labelize(series.data_key) ? series.label : undefined,
		color: series.color,
		valueFormat: series.value_format,
		isTotal: series.is_total,
		type: series.series_type,
		axis: series.y_axis,
	});
	return Object.keys(spec).length === 1 ? spec.key : spec;
}

function withoutUndefined<T extends object>(value: T): T {
	return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as T;
}
