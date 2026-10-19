import { createFileRoute } from '@tanstack/react-router';
import { useEffect } from 'react';
import type { ChartType } from '@nao/shared/chart-types';
import type { displayChart } from '@nao/shared/tools';

import { ChartDisplay } from '@/components/tool-calls/display-chart';
import { useTheme } from '@/contexts/theme.provider';

export const Route = createFileRoute('/embed/chart-label-preview')({
	validateSearch: (search: Record<string, unknown>): { theme: PreviewTheme } => ({
		theme: search.theme === 'dark' ? 'dark' : 'light',
	}),
	component: ChartLabelPreviewPage,
});

type PreviewTheme = 'light' | 'dark';

interface PreviewChart {
	title: string;
	note: string;
	chartType: ChartType;
	data: Record<string, unknown>[];
	series: displayChart.SeriesConfig[];
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun'];
const REVENUE = [980_000, 1_020_000, 1_005_000, 1_090_000, 1_150_000, 1_180_000];
const GROWTH = [20.1, -0.5, 8.5, 14.7, 6.2, 9.3];
const MONEY_FORMAT = { d3_format: '.2s', prefix: '$' };
const PERCENT_FORMAT = { d3_format: '.1f', suffix: '%' };

const REVENUE_WITH_GROWTH = MONTHS.map((month, index) => ({
	month,
	revenue: REVENUE[index],
	growth: GROWTH[index],
}));

const PREVIEW_CHARTS: PreviewChart[] = [
	{
		title: 'Issue #1972 — saturated bars under a line',
		note: 'Line labels land on dark purple bars: white ink with a bar-coloured halo.',
		chartType: 'mixed',
		data: REVENUE_WITH_GROWTH,
		series: [
			{ data_key: 'revenue', label: 'Revenue', color: '#4b2ff5', value_format: MONEY_FORMAT },
			{
				data_key: 'growth',
				label: 'Growth',
				color: '#4fb477',
				series_type: 'line',
				y_axis: 'right',
				value_format: PERCENT_FORMAT,
			},
		],
	},
	{
		title: 'Light bars under a line',
		note: 'Same layout on a pale yellow fill: dark ink is kept.',
		chartType: 'mixed',
		data: REVENUE_WITH_GROWTH,
		series: [
			{ data_key: 'revenue', label: 'Revenue', color: '#ffd166', value_format: MONEY_FORMAT },
			{
				data_key: 'growth',
				label: 'Growth',
				color: '#e4572e',
				series_type: 'line',
				y_axis: 'right',
				value_format: PERCENT_FORMAT,
			},
		],
	},
	{
		title: 'Theme colours (CSS variables)',
		note: 'Default palette resolved from the theme at runtime.',
		chartType: 'mixed',
		data: REVENUE_WITH_GROWTH,
		series: [
			{ data_key: 'revenue', label: 'Revenue', value_format: MONEY_FORMAT },
			{
				data_key: 'growth',
				label: 'Growth',
				series_type: 'line',
				y_axis: 'right',
				value_format: PERCENT_FORMAT,
			},
		],
	},
	{
		title: 'Grouped bars with wide labels',
		note: 'Labels spilling onto a neighbouring bar get a background sticker halo.',
		chartType: 'bar',
		data: [
			{ region: 'EMEA', online: 1_240_500, retail: 1_480_200, partner: 910_300 },
			{ region: 'NA', online: 2_050_900, retail: 1_220_700, partner: 1_610_400 },
			{ region: 'APAC', online: 980_100, retail: 1_710_800, partner: 1_390_600 },
			{ region: 'LATAM', online: 640_300, retail: 820_900, partner: 1_120_500 },
		],
		series: [
			{ data_key: 'online', label: 'Online', value_format: { d3_format: ',.0f', prefix: '$' } },
			{ data_key: 'retail', label: 'Retail', value_format: { d3_format: ',.0f', prefix: '$' } },
			{ data_key: 'partner', label: 'Partner', value_format: { d3_format: ',.0f', prefix: '$' } },
		],
	},
];

function ChartLabelPreviewPage() {
	const { theme } = Route.useSearch();
	useThemeClass(theme);

	return (
		<div className='mx-auto flex w-full max-w-6xl flex-col gap-6 p-8'>
			<header className='flex flex-col gap-1'>
				<h1 className='text-lg font-semibold'>Chart data label contrast</h1>
				<p className='text-sm text-muted-foreground'>Prototype preview with mocked data.</p>
			</header>
			<div className='grid grid-cols-2 gap-6'>
				{PREVIEW_CHARTS.map((chart) => (
					<PreviewChartCard key={chart.title} chart={chart} />
				))}
			</div>
		</div>
	);
}

function PreviewChartCard({ chart }: { chart: PreviewChart }) {
	const xAxisKey = Object.keys(chart.data[0])[0];
	return (
		<section className='flex flex-col gap-3 rounded-xl border bg-background p-4'>
			<div className='flex flex-col gap-0.5'>
				<h2 className='text-sm font-medium'>{chart.title}</h2>
				<p className='text-xs text-muted-foreground'>{chart.note}</p>
			</div>
			<ChartDisplay
				data={chart.data}
				chartType={chart.chartType}
				xAxisKey={xAxisKey}
				xAxisType='category'
				series={chart.series}
				showDataLabels
				disableTooltip
			/>
		</section>
	);
}

function useThemeClass(theme: PreviewTheme) {
	const { setTheme } = useTheme();
	useEffect(() => {
		setTheme(theme);
	}, [setTheme, theme]);
}
