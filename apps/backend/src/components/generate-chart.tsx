import { buildChart, defaultColorFor, labelize } from '@nao/shared';
import type { displayChart } from '@nao/shared/tools';
import React from 'react';
import { renderToString } from 'react-dom/server';

import { createSvg, type LegendEntry, svgToPng } from '../utils/generate-chart';

export interface RenderChartInput {
	config: Pick<displayChart.Input, 'chart_type' | 'x_axis_key' | 'x_axis_type' | 'series' | 'title'>;
	data: Record<string, unknown>[];
	width?: number;
	height?: number;
	margin?: { top?: number; right?: number; bottom?: number; left?: number };
	includeLegend?: boolean;
}

export function generateChartImage(input: RenderChartInput): Buffer {
	const svg = renderChartToSvg(input);
	return svgToPng(svg);
}

export function renderChartToSvg(input: RenderChartInput): string {
	const { config, data } = input;
	const width = input.width ?? 800;
	const height = input.height ?? 500;
	const margin = input.margin ?? { top: 10, right: 20, bottom: 5, left: 0 };
	const includeLegend = input.includeLegend !== false;

	const colorFor = (key: string, index: number) => {
		const series = config.series.find((s) => s.data_key === key);
		return series?.color || defaultColorFor(key, index);
	};

	const maxLabelWidth = estimateMaxLabelWidth(data, config.x_axis_key);

	const chart = buildChart({
		data,
		chartType: config.chart_type,
		xAxisKey: config.x_axis_key,
		xAxisType: config.x_axis_type === 'number' ? 'number' : 'category',
		series: config.series,
		colorFor,
		showGrid: true,
		margin,
		title: config.title,
		maxXAxisTicks: Math.floor(width / maxLabelWidth),
	});

	const html = renderToString(React.cloneElement(chart, { width, height }));

	const legend: LegendEntry[] = includeLegend
		? config.series.map((s, i) => ({
				label: s.label || labelize(s.data_key),
				dataKey: s.data_key,
				color: colorFor(s.data_key, i),
			}))
		: [];

	return createSvg(html, width, height, legend);
}

const CHAR_WIDTH_PX = 7;
const TICK_PADDING_PX = 16;
const MIN_TICK_WIDTH_PX = 40;

function estimateMaxLabelWidth(data: Record<string, unknown>[], xAxisKey: string): number {
	const maxCharCount = data.reduce((max, row) => {
		const formatted = labelize(String(row[xAxisKey] ?? ''));
		return Math.max(max, formatted.length);
	}, 0);
	return Math.max(maxCharCount * CHAR_WIDTH_PX + TICK_PADDING_PX, MIN_TICK_WIDTH_PX);
}
