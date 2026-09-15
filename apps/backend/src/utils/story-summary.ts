import type { StoryFormat } from '@nao/shared/dbt-charts';
import { resolveGridWidths, storyBlockRegex } from '@nao/shared/story-segments';
import { parseStoryTabs } from '@nao/shared/story-tabs';
import type { StorySummary, SummarySegment } from '@nao/shared/types';
import yaml from 'js-yaml';

const DBT_CHART_TYPE_TO_SILHOUETTE: Record<string, string> = {
	donut: 'pie',
	kpi: 'kpi_card',
	histogram: 'bar',
};

export function extractStorySummary(code: string, format: StoryFormat = 'markdown'): StorySummary {
	if (format === 'dbt_charts') {
		return { segments: extractBoardSegments(code) };
	}
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

/** A dbt Charts board summarises as one silhouette per chart, in `rows` order when present. */
function extractBoardSegments(boardYaml: string): SummarySegment[] {
	const charts = parseBoardCharts(boardYaml);
	return Object.values(charts).flatMap((chart): SummarySegment[] => {
		if (!chart || typeof chart !== 'object') {
			return [];
		}
		const { type, title, label } = chart as { type?: unknown; title?: unknown; label?: unknown };
		const chartTitle = typeof title === 'string' ? title : typeof label === 'string' ? label : '';
		const dbtType = typeof type === 'string' ? type : 'bar';
		if (dbtType === 'table') {
			return [{ type: 'table', title: chartTitle }];
		}
		const chartType = DBT_CHART_TYPE_TO_SILHOUETTE[dbtType] ?? dbtType;
		return [{ type: 'chart', chartType, title: chartTitle, ...(chartType === 'kpi_card' ? { kpiCount: 1 } : {}) }];
	});
}

function parseBoardCharts(boardYaml: string): Record<string, unknown> {
	try {
		const parsed: unknown = yaml.load(boardYaml);
		if (!parsed || typeof parsed !== 'object') {
			return {};
		}
		const charts = (parsed as { charts?: unknown }).charts;
		return charts && typeof charts === 'object' ? (charts as Record<string, unknown>) : {};
	} catch {
		return {};
	}
}

function extractSegments(code: string): SummarySegment[] {
	const segments: SummarySegment[] = [];
	const blockRegex = storyBlockRegex();
	let match;
	let lastIndex = 0;

	while ((match = blockRegex.exec(code)) !== null) {
		if (match.index > lastIndex) {
			const content = truncateText(code.slice(lastIndex, match.index));
			if (content) {
				segments.push({ type: 'text', content });
			}
		}

		if (match[2] !== undefined) {
			const attrs = parseAttributes(match[1] ?? '');
			const children = extractSegments(match[2]);
			const cols = parseInt(attrs.cols || String(children.length || 1), 10);
			const widths = resolveGridWidths(attrs.widths, children.length);
			segments.push({ type: 'grid', cols, widths, children });
		} else if (match[3] !== undefined) {
			const attrs = parseAttributes(match[3]);
			if (attrs.chart_type) {
				segments.push({
					type: 'chart',
					chartType: attrs.chart_type,
					title: attrs.title || '',
					...(attrs.chart_type === 'kpi_card' ? { kpiCount: countSeries(attrs.series) } : {}),
				});
			}
		} else if (match[4] !== undefined) {
			const attrs = parseAttributes(match[4]);
			segments.push({
				type: 'table',
				title: attrs.title || '',
			});
		} else if (match[6] !== undefined) {
			const attrs = parseAttributes(match[6]);
			segments.push({
				type: 'map',
				mapType: attrs.map_type || 'points',
				title: attrs.title || '',
			});
		}

		lastIndex = match.index + match[0].length;
	}

	if (lastIndex < code.length) {
		const content = truncateText(code.slice(lastIndex));
		if (content) {
			segments.push({ type: 'text', content });
		}
	}

	return segments;
}

function countSeries(series: string | undefined): number {
	if (!series) {
		return 1;
	}
	try {
		const parsed = JSON.parse(series);
		if (Array.isArray(parsed) && parsed.length > 0) {
			return parsed.length;
		}
	} catch {
		// ignore malformed series
	}
	return 1;
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

function parseAttributes(attrString: string): Record<string, string> {
	const attrs: Record<string, string> = {};
	const regex = /(\w+)=(?:"([^"]*)"|'([^']*)')/g;
	let match;
	while ((match = regex.exec(attrString)) !== null) {
		attrs[match[1]] = match[2] ?? match[3];
	}
	return attrs;
}
