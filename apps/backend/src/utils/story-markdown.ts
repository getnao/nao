import { formatChartValue, labelize } from '@nao/shared';
import { type DateFormatSettings, DEFAULT_DATE_FORMAT_SETTINGS } from '@nao/shared/date';
import type { ParsedChartBlock, ParsedMapBlock, ParsedTableBlock, Segment } from '@nao/shared/story-segments';
import { splitCodeIntoSegments } from '@nao/shared/story-segments';
import { formatCellValue, isNumericColumn } from '@nao/shared/story-table-utils';
import { flattenStoryTabs } from '@nao/shared/story-tabs';

import type { QueryDataMap, StoryInput } from './story-download';

export function generateStoryMarkdown(
	story: StoryInput,
	queryData: QueryDataMap | null,
	dateFormat?: DateFormatSettings | null,
): string {
	const resolvedDateFormat = dateFormat ?? { ...DEFAULT_DATE_FORMAT_SETTINGS };
	const flattened = flattenStoryTabs(story.code);
	const segments = splitCodeIntoSegments(flattened);

	const parts: string[] = [];

	if (story.title?.trim()) {
		parts.push(`# ${story.title.trim()}`);
	}

	for (const segment of segments) {
		const rendered = renderSegmentToMarkdown(segment, queryData, resolvedDateFormat);
		if (rendered.trim()) {
			parts.push(rendered.trim());
		}
	}

	return parts.join('\n\n') + '\n';
}

function renderSegmentToMarkdown(
	segment: Segment,
	queryData: QueryDataMap | null,
	dateFormat: DateFormatSettings,
): string {
	switch (segment.type) {
		case 'markdown':
			return segment.content.trim();

		case 'table':
			return renderTableSegment(segment.table, queryData, dateFormat);

		case 'chart':
			return renderChartSegment(segment.chart, queryData, dateFormat);

		case 'map':
			return renderMapSegment(segment.map, queryData);

		case 'grid':
			return segment.children
				.map((child) => renderSegmentToMarkdown(child, queryData, dateFormat))
				.filter((s) => s.trim().length > 0)
				.join('\n\n');

		case 'filter':
			return '';
	}
}

function renderTableSegment(
	table: ParsedTableBlock,
	queryData: QueryDataMap | null,
	dateFormat: DateFormatSettings,
): string {
	const parts: string[] = [];
	if (table.title?.trim()) {
		parts.push(`### ${table.title.trim()}`);
	}

	const tableData = queryData?.[table.queryId];
	if (!tableData || !tableData.columns || tableData.columns.length === 0) {
		return parts.join('\n\n');
	}

	const columns = tableData.columns;
	const rows = (tableData.data ?? []) as Record<string, unknown>[];

	const headerRow = `| ${columns.map((col) => escapeMarkdownCell(labelize(col))).join(' | ')} |`;
	const separatorRow = `| ${columns.map((col) => (isNumericColumn(rows, col) ? '---:' : '---')).join(' | ')} |`;

	const dataRows = rows.map((row) => {
		const cells = columns.map((col) => {
			const rawVal = row[col];
			const formatted = formatCellValue(rawVal, dateFormat);
			return escapeMarkdownCell(formatted);
		});
		return `| ${cells.join(' | ')} |`;
	});

	parts.push([headerRow, separatorRow, ...dataRows].join('\n'));
	return parts.join('\n\n');
}

function renderChartSegment(
	chart: ParsedChartBlock,
	queryData: QueryDataMap | null,
	dateFormat: DateFormatSettings,
): string {
	const parts: string[] = [];
	if (chart.title?.trim()) {
		parts.push(`### ${chart.title.trim()}`);
	}

	const chartData = queryData?.[chart.queryId];

	if (chart.chartType === 'kpi_card') {
		if (chartData?.data?.length) {
			const firstRow = chartData.data[0] as Record<string, unknown>;
			const seriesKey = chart.series?.[0]?.data_key ?? chartData.columns?.[0];
			if (seriesKey && firstRow[seriesKey] !== undefined) {
				const rawVal = firstRow[seriesKey];
				const value =
					typeof rawVal === 'number' ? formatChartValue(rawVal) : formatCellValue(rawVal, dateFormat);
				parts.push(`**${value}**`);
			}
		}
		return parts.join('\n\n');
	}

	const chartTypeLabel = labelize(chart.chartType.replace(/_/g, ' '));
	parts.push(`*(Chart: ${chartTypeLabel})*`);

	if (chartData && chartData.columns?.length && chartData.data?.length) {
		const rows = chartData.data as Record<string, unknown>[];
		const xAxisKey = chart.xAxisKey || chartData.columns[0];
		const seriesList =
			chart.series && chart.series.length > 0
				? chart.series
				: chartData.columns
						.filter((c) => c !== xAxisKey)
						.map((data_key) => ({ data_key, label: labelize(data_key) }));

		const headers = [
			labelize(chart.xAxisLabel || xAxisKey),
			...seriesList.map((s) => s.label || labelize(s.data_key)),
		];
		const headerRow = `| ${headers.map(escapeMarkdownCell).join(' | ')} |`;
		const separatorRow = `| --- | ${seriesList.map(() => '---:').join(' | ')} |`;

		const dataRows = rows.map((row) => {
			const xVal = escapeMarkdownCell(formatCellValue(row[xAxisKey], dateFormat));
			const seriesVals = seriesList.map((s) => {
				const rawVal = row[s.data_key];
				const formatted =
					typeof rawVal === 'number' ? formatChartValue(rawVal) : formatCellValue(rawVal, dateFormat);
				return escapeMarkdownCell(formatted);
			});
			return `| ${[xVal, ...seriesVals].join(' | ')} |`;
		});

		parts.push([headerRow, separatorRow, ...dataRows].join('\n'));
	}

	return parts.join('\n\n');
}

function renderMapSegment(map: ParsedMapBlock, queryData: QueryDataMap | null): string {
	const parts: string[] = [];
	if (map.title?.trim()) {
		parts.push(`### ${map.title.trim()}`);
	}
	const mapTypeLabel = labelize(map.mapType.replace(/_/g, ' '));
	parts.push(`*(Map: ${mapTypeLabel})*`);

	const mapData = queryData?.[map.queryId];
	if (mapData && mapData.columns?.length && mapData.data?.length) {
		const rows = (mapData.data ?? []) as Record<string, unknown>[];
		const labelKey = map.labelKey || map.regionKey || mapData.columns[0];
		const valKey = map.valueKey || map.sizeKey || mapData.columns.find((c) => c !== labelKey);

		if (labelKey && valKey) {
			const headers = [labelize(labelKey), labelize(valKey)];
			const headerRow = `| ${headers.map(escapeMarkdownCell).join(' | ')} |`;
			const separatorRow = `| --- | ---: |`;
			const dataRows = rows.map((row) => {
				const lVal = escapeMarkdownCell(String(row[labelKey] ?? ''));
				const vVal = escapeMarkdownCell(String(row[valKey] ?? ''));
				return `| ${lVal} | ${vVal} |`;
			});
			parts.push([headerRow, separatorRow, ...dataRows].join('\n'));
		}
	}

	return parts.join('\n\n');
}

function escapeMarkdownCell(value: string): string {
	return value.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}
