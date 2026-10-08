import { resolveDataKey } from '@nao/shared';
import { ChartNoAxesColumn, Code, TableIcon, TriangleAlert } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import type { ChartType } from '@nao/shared/chart-types';
import type { displayChart } from '@nao/shared/tools';
import type { TabBarItem } from '@/components/ui/tab-bar';
import type { ChartSelectionSeries, ChartSelectionSummary, ChartSelectionXAxis } from '@/lib/chart-selection-summary';

import { ChartDisplay } from '@/components/tool-calls/display-chart';
import { TableDisplay } from '@/components/tool-calls/display-table';
import { TabBar, tabPanelId, tabTriggerId } from '@/components/ui/tab-bar';
import { summarizeChartSelection } from '@/lib/chart-selection-summary';
import { sortByDateKey } from '@/lib/charts.utils';
import { cn } from '@/lib/utils';

type EditableChartInput = Omit<displayChart.KpiCardInput, 'chart_type'> & { chart_type: ChartType };

type PreviewTab = 'chart' | 'data' | 'query';

const TAB_ID_BASE = 'chart-editor-preview';
const X_AXIS_HIGHLIGHT = 'rgba(128, 128, 128, 0.18)';
const SERIES_HIGHLIGHT_ALPHA = '26';

interface ChartEditorPreviewProps {
	draft: EditableChartInput;
	data: Record<string, unknown>[];
	availableColumns: string[];
	palette: string[];
	queryView?: ReactNode;
}

/** Right-hand pane of the chart editor: live preview, source data, query and a summary of the selection. */
export function ChartEditorPreview({ draft, data, availableColumns, palette, queryView }: ChartEditorPreviewProps) {
	const [activeTab, setActiveTab] = useState<PreviewTab>('chart');
	const summary = useMemo(() => summarizeChartSelection(draft, data, palette), [draft, data, palette]);
	const tabs = useMemo(() => buildTabs(Boolean(queryView)), [queryView]);
	const resolvedTab = activeTab === 'query' && !queryView ? 'chart' : activeTab;

	return (
		<div className='flex h-full min-h-0 flex-col gap-4'>
			<TabBar tabs={tabs} activeTab={resolvedTab} onTabChange={setActiveTab} idBase={TAB_ID_BASE} />
			<div
				role='tabpanel'
				id={tabPanelId(TAB_ID_BASE, resolvedTab)}
				aria-labelledby={tabTriggerId(TAB_ID_BASE, resolvedTab)}
				className='min-h-0 flex-1 overflow-y-auto'
			>
				{resolvedTab === 'chart' && <LiveChartPreview draft={draft} data={data} summary={summary} />}
				{resolvedTab === 'data' && (
					<SourceDataPreview data={data} availableColumns={availableColumns} summary={summary} />
				)}
				{resolvedTab === 'query' && queryView}
			</div>
			<ChartSelectionExplainer summary={summary} />
		</div>
	);
}

function buildTabs(hasQuery: boolean): TabBarItem<PreviewTab>[] {
	const tabs: TabBarItem<PreviewTab>[] = [
		{ id: 'chart', label: 'Chart', icon: <ChartNoAxesColumn className='size-3.5' /> },
		{ id: 'data', label: 'Data', icon: <TableIcon className='size-3.5' /> },
	];
	if (hasQuery) {
		tabs.push({ id: 'query', label: 'Query', icon: <Code className='size-3.5' /> });
	}
	return tabs;
}

interface LiveChartPreviewProps {
	draft: EditableChartInput;
	data: Record<string, unknown>[];
	summary: ChartSelectionSummary;
}

function LiveChartPreview({ draft, data, summary }: LiveChartPreviewProps) {
	const chartData = useMemo(
		() =>
			draft.x_axis_type === 'date' && draft.x_axis_key
				? sortByDateKey(data, resolveDataKey(data, draft.x_axis_key))
				: data,
		[data, draft.x_axis_type, draft.x_axis_key],
	);

	if (data.length === 0 || summary.series.length === 0) {
		return (
			<PreviewPlaceholder>
				{data.length === 0 ? 'No data to preview.' : 'Add a series to preview the chart.'}
			</PreviewPlaceholder>
		);
	}

	const isKpi = draft.chart_type === 'kpi_card';
	return (
		<div className={cn('rounded-xl border bg-background p-4', !isKpi && 'h-80')}>
			<ChartDisplay
				data={chartData}
				chartType={draft.chart_type}
				xAxisKey={draft.x_axis_key ?? ''}
				xAxisType={draft.x_axis_type === 'number' ? 'number' : 'category'}
				xAxisLabel={draft.x_axis_label}
				series={draft.series}
				title={draft.title}
				yAxisMin={draft.y_axis_min}
				yAxisMax={draft.y_axis_max}
				yAxisLabel={draft.y_axis_label}
				yAxisRightMin={draft.y_axis_right_min}
				yAxisRightMax={draft.y_axis_right_max}
				yAxisRightLabel={draft.y_axis_right_label}
				showDataLabels={draft.show_data_labels}
				comparisonMode={draft.comparison_mode}
				hideTotal={draft.hide_total}
				normalSize
			/>
		</div>
	);
}

interface SourceDataPreviewProps {
	data: Record<string, unknown>[];
	availableColumns: string[];
	summary: ChartSelectionSummary;
}

function SourceDataPreview({ data, availableColumns, summary }: SourceDataPreviewProps) {
	const columns = availableColumns.length > 0 ? availableColumns : Object.keys(data[0] ?? {});
	const highlightByColumn = useMemo(() => buildColumnHighlights(summary), [summary]);
	const cellBackground = useMemo(
		() => (column: string) => highlightByColumn.get(column.toLowerCase()),
		[highlightByColumn],
	);

	if (data.length === 0) {
		return <PreviewPlaceholder>The query returned no rows.</PreviewPlaceholder>;
	}

	return (
		<div className='flex flex-col gap-2'>
			<p className='text-xs text-muted-foreground'>
				Columns used by the chart are tinted: the X axis in grey, each series in its own colour.
			</p>
			<TableDisplay
				data={data}
				columns={columns}
				cellBackground={cellBackground}
				tableContainerClassName='max-h-[28rem] rounded-xl bg-background'
				maxRowsBeforePagination={15}
				compactFooter
			/>
		</div>
	);
}

function buildColumnHighlights(summary: ChartSelectionSummary): Map<string, string> {
	const highlights = new Map<string, string>();
	if (summary.xAxis?.profile.exists) {
		highlights.set(summary.xAxis.profile.column.toLowerCase(), X_AXIS_HIGHLIGHT);
	}
	for (const series of summary.series) {
		if (series.profile.exists && !highlights.has(series.column.toLowerCase())) {
			highlights.set(series.column.toLowerCase(), `${series.color}${SERIES_HIGHLIGHT_ALPHA}`);
		}
	}
	return highlights;
}

function ChartSelectionExplainer({ summary }: { summary: ChartSelectionSummary }) {
	return (
		<section className='flex shrink-0 flex-col gap-2 rounded-xl border bg-background p-4 text-sm'>
			<header className='flex items-center justify-between gap-2'>
				<h4 className='font-semibold text-foreground'>What this chart shows</h4>
				<span className='text-xs text-muted-foreground'>
					{summary.chartLabel} · {formatCount(summary.rowCount, 'row')}
				</span>
			</header>
			<dl className='grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1.5'>
				{summary.xAxis ? <XAxisRow xAxis={summary.xAxis} /> : null}
				{summary.series.map((series, index) => (
					<SeriesRow key={`${series.column}-${index}`} series={series} />
				))}
			</dl>
			{summary.issues.length > 0 && (
				<ul className='mt-1 flex flex-col gap-1'>
					{summary.issues.map((issue) => (
						<li key={issue} className='flex items-start gap-1.5 text-xs text-amber-700 dark:text-amber-400'>
							<TriangleAlert className='mt-0.5 size-3.5 shrink-0' />
							<span>{issue}</span>
						</li>
					))}
				</ul>
			)}
		</section>
	);
}

function XAxisRow({ xAxis }: { xAxis: ChartSelectionXAxis }) {
	const { profile } = xAxis;
	const details = [
		`${xAxis.axisType} axis`,
		profile.exists ? formatCount(profile.distinctCount, 'distinct value') : 'missing column',
		describeRange(profile),
	].filter(Boolean);
	return (
		<>
			<dt className='text-xs font-medium uppercase tracking-wide text-muted-foreground'>X axis</dt>
			<dd className='flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5'>
				<FieldName label={xAxis.label} column={profile.column} />
				<span className='text-xs text-muted-foreground'>{details.join(' · ')}</span>
			</dd>
		</>
	);
}

function SeriesRow({ series }: { series: ChartSelectionSeries }) {
	const { profile } = series;
	const details = [
		series.seriesType ? `${series.seriesType} series` : undefined,
		series.yAxis === 'right' ? 'right axis' : undefined,
		series.isTotal ? 'total' : undefined,
		profile.exists ? profile.kind : 'missing column',
		describeRange(profile),
		profile.sum !== undefined ? `sum ${formatNumber(profile.sum)}` : undefined,
		series.formatDescription,
	].filter(Boolean);
	return (
		<>
			<dt className='flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground'>
				<span className='size-2.5 rounded-full border' style={{ backgroundColor: series.color }} aria-hidden />
				Series
			</dt>
			<dd className='flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5'>
				<FieldName label={series.label} column={series.column} />
				<span className='text-xs text-muted-foreground'>{details.join(' · ')}</span>
			</dd>
		</>
	);
}

function FieldName({ label, column }: { label: string; column: string }) {
	const columnName = <code className='rounded bg-muted px-1 py-0.5 font-mono text-xs text-foreground'>{column}</code>;
	if (label === column) {
		return columnName;
	}
	return (
		<>
			<span className='font-medium text-foreground'>{label}</span>
			{columnName}
		</>
	);
}

function PreviewPlaceholder({ children }: { children: ReactNode }) {
	return (
		<div className='flex h-40 items-center justify-center rounded-xl border border-dashed text-sm text-muted-foreground'>
			{children}
		</div>
	);
}

function describeRange(profile: ChartSelectionSummary['series'][number]['profile']): string | undefined {
	if (!profile.exists) {
		return undefined;
	}
	if (profile.kind === 'number' && profile.min !== undefined && profile.max !== undefined) {
		return `${formatNumber(profile.min)} – ${formatNumber(profile.max)}`;
	}
	if (profile.first !== undefined && profile.last !== undefined && profile.first !== profile.last) {
		return `${profile.first} → ${profile.last}`;
	}
	return undefined;
}

const compactNumberFormat = new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 2 });

function formatNumber(value: number): string {
	return compactNumberFormat.format(value);
}

function formatCount(count: number, noun: string): string {
	return `${count} ${noun}${count === 1 ? '' : 's'}`;
}
