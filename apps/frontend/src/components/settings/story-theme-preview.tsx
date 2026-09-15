import { splitCodeIntoSegments } from '@nao/shared/story-segments';
import { X } from 'lucide-react';
import { useMemo } from 'react';
import type { StoryTheme } from '@nao/shared/story-theme';

import type { QueryDataMap } from '@/components/story-embeds';
import { useStoryThemeEditor } from '@/components/settings/story-theme-editor-context';
import { StoryBlock, StoryTableFrame } from '@/components/story-block';
import { StoryChartEmbed, StoryTableEmbed } from '@/components/story-embeds';
import { SegmentList } from '@/components/story-rendering';
import { StoryThemeProvider } from '@/components/story-theme-provider';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { useSidePanel } from '@/contexts/side-panel';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun'];
const REGIONS = [
	{ key: 'north_america', label: 'North America' },
	{ key: 'europe', label: 'Europe' },
	{ key: 'asia_pacific', label: 'Asia Pacific' },
];
const REVENUE_BY_REGION = [
	[420, 465, 510, 488, 552, 601],
	[310, 328, 355, 372, 398, 421],
	[180, 205, 232, 260, 291, 330],
];

const PREVIEW_DATA: QueryDataMap = {
	revenue_by_region: {
		columns: ['month', ...REGIONS.map((region) => region.key)],
		data: MONTHS.map((month, index) => ({
			month,
			...Object.fromEntries(
				REGIONS.map((region, regionIndex) => [region.key, REVENUE_BY_REGION[regionIndex][index]]),
			),
		})),
	},
	revenue_total: {
		columns: ['month', 'revenue'],
		data: MONTHS.map((month, index) => ({
			month,
			revenue: REVENUE_BY_REGION.reduce((sum, series) => sum + series[index], 0),
		})),
	},
	kpi_metrics: {
		columns: ['month', 'total_revenue', 'new_customers', 'average_order'],
		data: MONTHS.map((month, index) => ({
			month,
			total_revenue: REVENUE_BY_REGION.reduce((sum, series) => sum + series[index], 0) * 1000,
			new_customers: 180 + index * 24,
			average_order: 312 + index * 9,
		})),
	},
	region_totals: {
		columns: ['Region', 'Revenue', 'Growth'],
		data: REGIONS.map((region, regionIndex) => {
			const series = REVENUE_BY_REGION[regionIndex];
			const growth = ((series[series.length - 1] / series[0] - 1) * 100).toFixed(1);
			return {
				Region: region.label,
				Revenue: series.reduce((sum, value) => sum + value, 0),
				Growth: `${growth}%`,
			};
		}),
	},
};

const seriesAttribute = (series: { key: string; label: string }[]) =>
	JSON.stringify(series.map((entry) => ({ data_key: entry.key, label: entry.label })));

const kpiTag = (key: string, label: string) =>
	`<chart query_id="kpi_metrics" chart_type="kpi_card" x_axis_key="month" series='${seriesAttribute([{ key, label }])}' />`;

const PREVIEW_CODE = [
	'# Revenue overview',
	'',
	'The same headings, prose, KPI tiles, charts and tables a custom story is built from, rendered in this theme.',
	'',
	'<grid cols="3">',
	'',
	kpiTag('total_revenue', 'Total revenue'),
	'',
	kpiTag('new_customers', 'New customers'),
	'',
	kpiTag('average_order', 'Average order'),
	'',
	'</grid>',
	'',
	'## What changed this quarter',
	'',
	'- Every region grew month over month, with Asia Pacific accelerating fastest.',
	'- June was the strongest month on record for total revenue.',
	'',
	`<chart query_id="revenue_by_region" chart_type="bar" x_axis_key="month" series='${seriesAttribute(REGIONS)}' title="Revenue by region" />`,
	'',
	`<chart query_id="revenue_total" chart_type="line" x_axis_key="month" series='${seriesAttribute([{ key: 'revenue', label: 'Revenue' }])}' title="Total revenue" />`,
	'',
	'<table query_id="region_totals" title="Regions" />',
].join('\n');

export function StoryThemePreview({ theme }: { theme: StoryTheme }) {
	const segments = useMemo(() => splitCodeIntoSegments(PREVIEW_CODE), []);

	return (
		<StoryThemeProvider theme={theme}>
			<div className='min-h-full bg-background text-foreground'>
				<div className='mx-auto flex max-w-5xl flex-col gap-4 p-4 md:p-8'>
					<SegmentList
						segments={segments}
						renderChart={(chart) => (
							<StoryBlock>
								<StoryChartEmbed chart={chart} queryData={PREVIEW_DATA} />
							</StoryBlock>
						)}
						renderTable={(table) => (
							<StoryTableFrame>
								<StoryTableEmbed table={table} queryData={PREVIEW_DATA} />
							</StoryTableFrame>
						)}
						renderMap={() => null}
					/>
				</div>
			</div>
		</StoryThemeProvider>
	);
}

export function StoryThemePreviewPanel() {
	const { theme } = useStoryThemeEditor();
	const { close } = useSidePanel();

	return (
		<div className='flex h-full flex-col'>
			<div className='flex items-center gap-2 border-b px-4 py-2'>
				<Button
					variant='ghost'
					size='icon-sm'
					className='mr-2 hover:rounded-full'
					onClick={close}
					aria-label='Close preview'
				>
					<X className='size-4' strokeWidth={2.25} />
				</Button>
				<div className='flex min-w-0 flex-col'>
					<span className='text-sm font-medium'>Live preview</span>
					<span className='truncate text-xs text-muted-foreground'>Follows your edits before you save.</span>
				</div>
			</div>
			<div className='min-h-0 flex-1 overflow-auto'>
				{theme ? (
					<StoryThemePreview theme={theme} />
				) : (
					<div className='flex h-full items-center justify-center'>
						<Spinner className='size-5' />
					</div>
				)}
			</div>
		</div>
	);
}
