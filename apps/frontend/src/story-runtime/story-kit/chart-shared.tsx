import { buildChart, labelize } from '@nao/shared/chart-builder';
import {
	buildSeriesChartConfig,
	buildSeriesLegendPayload,
	seriesColorAt as seriesColor,
	useSeriesVisibility,
} from '@nao/shared/chart-series';
import { ChartConfigProvider, ChartLegendContent, ChartTooltipContent } from '@nao/shared/chart-tooltip';
import { isComboChart, isPercentStackedChartType } from '@nao/shared/chart-types';
import { toFiniteNumber } from '@nao/shared/chart-values';
import { useId } from 'react';
import { Legend, ResponsiveContainer, Tooltip } from 'recharts';

import { Block, BlockState } from './block';
import { chartBlockConfig, resolveChart, toSeriesConfigs } from './block-config';
import { useStoryTheme } from './hooks';
import { useBlockData } from './use-block-data';
import type { BlockDataSource, Row } from './use-block-data';
import type { ChartOptions } from './block-config';
import type { BlockProps } from './block';
import type { displayChart } from '@nao/shared/tools';
import type { ChartType } from '@nao/shared/chart-types';
import type { StoryKitBlockRef } from '@nao/shared/story-app';

export { seriesColor };

export interface ChartProps extends BlockProps, BlockDataSource, ChartOptions {
	height?: number;
	showLegend?: boolean;
	showGrid?: boolean;
}

interface ChartBlockProps extends ChartProps {
	kind: string;
	chartType: ChartType;
	blockRef: StoryKitBlockRef;
}

const DEFAULT_CHART_HEIGHT = 260;

const CHART_MARGIN = { top: 8, right: 8, bottom: 0, left: 0 };

export function ChartBlock({
	kind,
	chartType,
	blockRef,
	queryId,
	data,
	height = DEFAULT_CHART_HEIGHT,
	showLegend,
	showGrid = true,
	title,
	description,
	className,
	style,
	...options
}: ChartBlockProps) {
	const source = useBlockData({ queryId, data });
	const resolved = source.status === 'ready' ? resolveChart(source.rows, source.columns, options) : null;
	const edit =
		resolved && source.status === 'ready'
			? {
					block: blockRef,
					config: chartBlockConfig(chartType, queryId, title, resolved, options),
					columns: source.columns,
					rows: source.rows,
				}
			: undefined;

	return (
		<Block kind={kind} title={title} description={description} className={className} style={style} edit={edit}>
			<BlockState data={source}>
				{(rows) =>
					resolved && (
						<ChartBody
							rows={toChartRows(rows, resolved.series)}
							chartType={chartType}
							xAxisKey={resolved.xAxisKey}
							series={toSeriesConfigs(resolved.series, options)}
							height={height}
							showLegend={showLegend ?? resolved.series.length > 1}
							showGrid={showGrid}
							options={options}
						/>
					)
				}
			</BlockState>
		</Block>
	);
}

interface ChartBodyProps {
	rows: Row[];
	chartType: ChartType;
	xAxisKey: string;
	series: displayChart.SeriesConfig[];
	height: number;
	showLegend: boolean;
	showGrid: boolean;
	options: ChartOptions;
}

function ChartBody({ rows, chartType, xAxisKey, series, height, showLegend, showGrid, options }: ChartBodyProps) {
	const theme = useStoryTheme();
	const gradientIdPrefix = useId();
	const { visibleSeries, hiddenSeriesKeys, handleToggleSeriesVisibility } = useSeriesVisibility(series);
	const isDualAxis = isComboChart(chartType) && visibleSeries.some((item) => item.y_axis === 'right');

	const chart = buildChart({
		data: rows,
		chartType,
		xAxisKey,
		xAxisType: options.xAxisType === 'number' ? 'number' : 'category',
		xAxisLabel: options.xAxisLabel,
		yAxisMin: options.yAxisMin,
		yAxisMax: options.yAxisMax,
		yAxisLabel: options.yAxisLabel,
		yAxisRightMin: options.yAxisRightMin,
		yAxisRightMax: options.yAxisRightMax,
		yAxisRightLabel: options.yAxisRightLabel,
		showDataLabels: options.showDataLabels,
		series: visibleSeries,
		colorFor: seriesColorLookup(series),
		showGrid,
		margin: CHART_MARGIN,
		backgroundColor: 'var(--card)',
		gradientIdPrefix,
		chartStyle: theme ? { barRadius: theme.charts.barRadius } : undefined,
		children: [
			<Tooltip
				key='tooltip'
				animationDuration={150}
				animationEasing='linear'
				allowEscapeViewBox={{ y: false, x: false }}
				content={
					<ChartTooltipContent
						percent={isPercentStackedChartType(chartType)}
						isDualAxis={isDualAxis}
						hideTotal={options.hideTotal}
						labelFormatter={(value) => labelize(value)}
					/>
				}
			/>,
			showLegend && (
				<Legend
					key='legend'
					payload={buildSeriesLegendPayload(series, hiddenSeriesKeys, labelize)}
					layout='horizontal'
					align='center'
					verticalAlign='bottom'
					content={<ChartLegendContent onItemClick={handleToggleSeriesVisibility} />}
				/>
			),
		].filter(Boolean),
	});

	return (
		<ChartConfigProvider config={buildSeriesChartConfig(series, labelize)}>
			<div className='nao-chart' style={{ height }}>
				<ResponsiveContainer width='100%' height='100%'>
					{chart}
				</ResponsiveContainer>
			</div>
		</ChartConfigProvider>
	);
}

function toChartRows(rows: Row[], series: { key: string }[]): Row[] {
	return rows.map((row) => {
		const next: Row = { ...row };
		for (const { key } of series) {
			next[key] = toFiniteNumber(row[key]);
		}
		return next;
	});
}

function seriesColorLookup(series: displayChart.SeriesConfig[]): (key: string, index: number) => string {
	const colors = new Map(series.map((item, index) => [item.data_key, item.color || seriesColor(index)]));
	return (key, index) => colors.get(key) ?? seriesColor(index);
}
