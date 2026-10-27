import { type Segment, splitCodeIntoSegments } from '@nao/shared/story-segments';
import { parseStoryTabs } from '@nao/shared/story-tabs';
import type { StorySummary, SummarySegment } from '@nao/shared/types';

export function extractStorySummary(code: string): StorySummary {
	const tabs = parseStoryTabs(code);
	if (!tabs?.length) {
		return { segments: extractSegments(code) };
	}
	const segments: SummarySegment[] = [];
	for (const tab of tabs) {
		const title = truncateText(tab.title);
		if (title) {
			segments.push({ type: 'text', content: title });
		}
		segments.push(...extractSegments(tab.innerCode));
	}
	return { segments };
}

function extractSegments(code: string): SummarySegment[] {
	return splitCodeIntoSegments(code).flatMap(summarySegmentsFromSegment);
}

function summarySegmentsFromSegment(segment: Segment): SummarySegment[] {
	switch (segment.type) {
		case 'markdown': {
			const content = truncateText(segment.content);
			if (content) {
				return [{ type: 'text', content }];
			}
			return [];
		}
		case 'chart': {
			const colors = segment.chart.series.map((series, i) => series.color || defaultColor(i));
			return [
				{
					type: 'chart',
					chartType: segment.chart.chartType,
					title: segment.chart.title,
					...(segment.chart.chartType === 'kpi_card'
						? {
								kpiCount: Math.max(segment.chart.series.length, 1),
								queryId: segment.chart.queryId,
								series: segment.chart.series.map((series) => ({
									dataKey: series.data_key,
									...(series.label ? { label: series.label } : {}),
									...(series.value_format ? { valueFormat: series.value_format } : {}),
								})),
							}
						: {}),
					...(colors.length > 0 ? { colors } : {}),
				},
			];
		}
		case 'table':
			return [{ type: 'table', title: segment.table.title }];
		case 'map':
			return [
				{
					type: 'map',
					mapType: segment.map.mapType,
					title: segment.map.title,
					...(segment.map.color ? { color: segment.map.color } : {}),
				},
			];
		case 'grid':
			return summarizeGrid(segment);
		case 'filter':
			return [];
	}
}

function summarizeGrid(grid: Extract<Segment, { type: 'grid' }>): SummarySegment[] {
	const columns = grid.children.flatMap((child, index) =>
		summarySegmentsFromSegment(child).map((summary) => ({ summary, width: grid.widths?.[index] })),
	);
	if (columns.length === 0) {
		return [];
	}
	const widths = grid.widths ? columns.map((column) => column.width ?? 1) : null;
	return [
		{
			type: 'grid',
			cols: Math.min(grid.cols, columns.length),
			widths,
			children: columns.map((column) => column.summary),
		},
	];
}

function defaultColor(index: number): string {
	return `var(--chart-${(index % 11) + 1})`;
}

function truncateText(raw: string): string {
	const lines = raw
		.split('\n')
		.map((l) => l.trimEnd())
		.filter((l) => l.length > 0);

	const truncated = lines.slice(0, 10).map((line) => {
		if (line.length > 80) {
			return line.slice(0, 80);
		}
		return line;
	});

	return truncated.join('\n');
}
