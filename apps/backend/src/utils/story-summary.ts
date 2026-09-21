import { resolveGridWidths, storyBlockRegex } from '@nao/shared/story-segments';
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
