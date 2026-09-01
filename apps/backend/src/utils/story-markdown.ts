import { formatChartValue, labelize, resolveDataKey, resolveMapConfig } from '@nao/shared';
import { type DateFormatSettings, DEFAULT_DATE_FORMAT_SETTINGS } from '@nao/shared/date';
import type { ParsedChartBlock, ParsedMapBlock, ParsedTableBlock, Segment } from '@nao/shared/story-segments';
import { mapBlockToInput, splitCodeIntoSegments } from '@nao/shared/story-segments';
import { formatCellValue, isNumericColumn } from '@nao/shared/story-table-utils';
import { flattenStoryTabs } from '@nao/shared/story-tabs';

import type { QueryDataMap, StoryInput } from './story-download';

export function generateStoryMarkdown(
	story: StoryInput,
	queryData: QueryDataMap | null,
	dateFormat?: DateFormatSettings | null,
): string {
	const resolvedDateFormat = dateFormat ?? { ...DEFAULT_DATE_FORMAT_SETTINGS };
	const flattenedTabs = flattenStoryTabs(story.code);
	const flattenedCode = flattenedTabs.replace(/<\/?grid\b[^>]*>/gi, '');
	const segments = splitCodeIntoSegments(flattenedCode);

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
			return renderMapSegment(segment.map, queryData, dateFormat);

		case 'grid':
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
			const rows = chartData.data as Record<string, unknown>[];
			const resolvedXAxisKey = resolveDataKey(rows, chart.xAxisKey);
			const sortedRows = [...rows].sort((a, b) => {
				const av = a[resolvedXAxisKey];
				const bv = b[resolvedXAxisKey];
				if (chart.xAxisType === 'date') {
					return new Date(String(av)).getTime() - new Date(String(bv)).getTime();
				}
				return 0;
			});
			const lastRow = sortedRows[sortedRows.length - 1] ?? {};

			const fallbackSeries = chartData.columns
				.filter((col) => !resolvedXAxisKey || col.toLowerCase() !== resolvedXAxisKey.toLowerCase())
				.map((data_key) => ({ data_key, label: labelize(data_key) }));

			const seriesList = (chart.series && chart.series.length > 0 ? chart.series : fallbackSeries).map((s) => ({
				...s,
				data_key: resolveDataKey(rows, s.data_key),
			}));

			const kpiItems = seriesList
				.map((s) => {
					const rawVal = lastRow[s.data_key];
					const value =
						typeof rawVal === 'number'
							? formatChartValue(rawVal, s.value_format)
							: rawVal != null
								? formatCellValue(rawVal, dateFormat)
								: '';
					const label = s.label ?? s.data_key;
					const escapedLabel = escapeMarkdownCell(label);
					const escapedValue = escapeMarkdownCell(value);
					return seriesList.length === 1 && !s.label
						? `**${escapedValue}**`
						: `**${escapedLabel}:** ${escapedValue}`;
				})
				.filter((item) => item.trim().length > 0);

			if (kpiItems.length > 0) {
				parts.push(kpiItems.join(' · '));
			}
		}
		return parts.join('\n\n');
	}

	const chartTypeLabel = labelize(chart.chartType.replace(/_/g, ' '));
	parts.push(`*(Chart: ${chartTypeLabel})*`);

	if (chartData && chartData.columns?.length && chartData.data?.length) {
		const rows = chartData.data as Record<string, unknown>[];
		const xAxisKey = resolveDataKey(rows, chart.xAxisKey) || chartData.columns[0];
		const seriesList = (
			chart.series && chart.series.length > 0
				? chart.series
				: chartData.columns
						.filter((c) => c.toLowerCase() !== xAxisKey.toLowerCase())
						.map((data_key) => ({ data_key, label: labelize(data_key) }))
		).map((s) => ({
			...s,
			data_key: resolveDataKey(rows, s.data_key),
		}));

		if (seriesList.length > 0 && rows.length > 0) {
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
						typeof rawVal === 'number'
							? formatChartValue(rawVal, s.value_format)
							: formatCellValue(rawVal, dateFormat);
					return escapeMarkdownCell(formatted);
				});
				return `| ${[xVal, ...seriesVals].join(' | ')} |`;
			});

			parts.push([headerRow, separatorRow, ...dataRows].join('\n'));
		}
	}

	return parts.join('\n\n');
}

function renderMapSegment(map: ParsedMapBlock, queryData: QueryDataMap | null, dateFormat: DateFormatSettings): string {
	const parts: string[] = [];
	if (map.title?.trim()) {
		parts.push(`### ${map.title.trim()}`);
	}
	const mapTypeLabel = labelize(map.mapType.replace(/_/g, ' '));
	parts.push(`*(Map: ${mapTypeLabel})*`);

	const mapData = queryData?.[map.queryId];
	if (mapData && mapData.columns?.length && mapData.data?.length) {
		const rows = (mapData.data ?? []) as Record<string, unknown>[];
		const config = resolveMapConfig(rows, mapBlockToInput(map));
		const labelKey =
			config.map_type === 'choropleth'
				? config.region_key
				: config.map_type === 'bubble'
					? config.label_key || config.latitude_key
					: config.label_key || config.latitude_key;
		const valKey =
			config.map_type === 'choropleth'
				? config.value_key
				: config.map_type === 'bubble'
					? config.size_key || config.color_key
					: config.color_key;

		const resolvedLabelKey = resolveDataKey(rows, labelKey) || mapData.columns[0];
		const resolvedValKey = resolveDataKey(rows, valKey) || mapData.columns.find((c) => c !== resolvedLabelKey);

		if (resolvedLabelKey && resolvedValKey) {
			const headers = [labelize(resolvedLabelKey), labelize(resolvedValKey)];
			const headerRow = `| ${headers.map(escapeMarkdownCell).join(' | ')} |`;
			const separatorRow = `| --- | ---: |`;
			const dataRows = rows.map((row) => {
				const lVal = escapeMarkdownCell(formatCellValue(row[resolvedLabelKey], dateFormat));
				const vVal = escapeMarkdownCell(formatCellValue(row[resolvedValKey], dateFormat));
				return `| ${lVal} | ${vVal} |`;
			});
			parts.push([headerRow, separatorRow, ...dataRows].join('\n'));
		}
	}

	return parts.join('\n\n');
}

function escapeMarkdownCell(value: string): string {
	return value
		.replace(/\\/g, '\\\\')
		.replace(/\|/g, '\\|')
		.replace(/\*/g, '\\*')
		.replace(/_/g, '\\_')
		.replace(/`/g, '\\`')
		.replace(/\[/g, '\\[')
		.replace(/\]/g, '\\]')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/\r?\n/g, ' ');
}
