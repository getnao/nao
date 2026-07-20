import { bucketPieData, buildChart, defaultColorFor, labelize } from '@nao/shared';
import type { DateFormatSettings } from '@nao/shared/date';
import type { displayChart } from '@nao/shared/tools';
import React from 'react';
import { renderToString } from 'react-dom/server';

import {
	createSvg,
	type LegendEntry,
	type LegendLayout,
	svgToPng,
	VERTICAL_LEGEND_WIDTH,
} from '../utils/generate-chart';

export interface RenderChartInput {
	config: Pick<
		displayChart.ChartInput,
		| 'chart_type'
		| 'x_axis_key'
		| 'x_axis_type'
		| 'series'
		| 'y_axis_min'
		| 'y_axis_max'
		| 'title'
		| 'show_data_labels'
	>;
	data: Record<string, unknown>[];
	width?: number;
	height?: number;
	margin?: { top?: number; right?: number; bottom?: number; left?: number };
	includeLegend?: boolean;
	dateFormat?: DateFormatSettings | null;
}

export function generateChartImage(input: RenderChartInput): Buffer {
	const svg = renderChartToSvg(input);
	return svgToPng(svg);
}

export function renderChartToSvg(input: RenderChartInput): string {
	const { config, data, dateFormat } = input;
	const width = input.width ?? 800;
	const height = input.height ?? 500;
	const margin = input.margin ?? { top: 10, right: 20, bottom: 5, left: 0 };
	const includeLegend = input.includeLegend !== false;

	const colorFor = (key: string, index: number) => {
		const series = config.series.find((s) => s.data_key === key);
		return series?.color || defaultColorFor(key, index);
	};

	const labelFormatter = (value: string) => labelize(value, dateFormat);
	const maxLabelWidth = estimateMaxLabelWidth(data, config.x_axis_key, dateFormat);

	const isPie = config.chart_type === 'pie' || config.chart_type === 'donut';

	const chartData = isPie ? bucketPieData(data, config.x_axis_key, config.series[0]?.data_key ?? '') : data;

	let legend: LegendEntry[] = [];
	if (includeLegend) {
		legend = isPie
			? buildPieLegendEntries(chartData, config.x_axis_key, dateFormat)
			: config.series.map((s, i) => ({
					label: s.label || labelize(s.data_key, dateFormat),
					color: colorFor(s.data_key, i),
				}));
	}

	// Only reserve the right-hand legend column when a vertical legend is drawn.
	const hasRightLegend = isPie && legend.length > 0;
	const legendLayout: LegendLayout = hasRightLegend ? 'vertical' : 'horizontal';
	const chartWidth = hasRightLegend ? Math.max(width - VERTICAL_LEGEND_WIDTH, 0) : width;

	const chart = buildChart({
		data: chartData,
		chartType: config.chart_type,
		xAxisKey: config.x_axis_key,
		xAxisType: config.x_axis_type === 'number' ? 'number' : 'category',
		series: config.series,
		colorFor,
		labelFormatter,
		showGrid: true,
		showDataLabels: config.show_data_labels,
		margin,
		title: config.title,
		maxXAxisTicks: Math.floor(chartWidth / maxLabelWidth),
		backgroundColor: '#ffffff',
		yAxisMin: config.y_axis_min,
		yAxisMax: config.y_axis_max,
	});

	const html = renderToString(React.cloneElement(chart, { width: chartWidth, height }));

	return createSvg(html, chartWidth, height, legend, legendLayout);
}

function buildPieLegendEntries(
	bucketedRows: Record<string, unknown>[],
	categoryKey: string,
	dateFormat?: DateFormatSettings | null,
): LegendEntry[] {
	return bucketedRows.map((row, i) => {
		const category = String(row[categoryKey]);
		return { label: labelize(category, dateFormat), color: defaultColorFor(category, i) };
	});
}

const CHAR_WIDTH_PX = 7;
const TICK_PADDING_PX = 16;
const MIN_TICK_WIDTH_PX = 40;

function estimateMaxLabelWidth(
	data: Record<string, unknown>[],
	xAxisKey: string,
	dateFormat?: DateFormatSettings | null,
): number {
	const maxCharCount = data.reduce((max, row) => {
		const formatted = labelize(String(row[xAxisKey] ?? ''), dateFormat);
		return Math.max(max, formatted.length);
	}, 0);
	return Math.max(maxCharCount * CHAR_WIDTH_PX + TICK_PADDING_PX, MIN_TICK_WIDTH_PX);
}
