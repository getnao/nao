export interface ParsedChartBlock {
	queryId: string;
	chartType: string;
	xAxisKey: string;
	xAxisType: string | null;
	series: Array<{ data_key: string; color: string; label?: string }>;
	title: string;
}

export interface ParsedTableBlock {
	queryId: string;
	title: string;
}

export type Segment =
	| { type: 'markdown'; content: string }
	| { type: 'chart'; chart: ParsedChartBlock }
	| { type: 'table'; table: ParsedTableBlock }
	| { type: 'grid'; cols: number; children: Segment[] };

function unescapeAttributeValue(value: string): string {
	return value.replace(/\\(["'\\])/g, '$1');
}

export function parseChartAttributes(attrString: string): Record<string, string> {
	const attrs: Record<string, string> = {};
	const attrRegex = /(\w+)=(?:"((?:\\.|[^"\\])*)"|'((?:\\.|[^'\\])*)')/g;
	let match;
	while ((match = attrRegex.exec(attrString)) !== null) {
		attrs[match[1]] = unescapeAttributeValue(match[2] ?? match[3] ?? '');
	}
	return attrs;
}

export function parseChartBlock(attrString: string): ParsedChartBlock | null {
	const attrs = parseChartAttributes(attrString);
	if (!attrs.query_id || !attrs.chart_type || !attrs.x_axis_key) {
		return null;
	}

	const series: ParsedChartBlock['series'] = [];
	if (attrs.series) {
		try {
			const parsed = JSON.parse(attrs.series);
			if (Array.isArray(parsed)) {
				series.push(...parsed);
			}
		} catch {
			/* ignore malformed series */
		}
	} else if (attrs.data_key) {
		series.push({
			data_key: attrs.data_key,
			color: attrs.color || 'var(--chart-1)',
			label: attrs.label,
		});
	}

	return {
		queryId: attrs.query_id,
		chartType: attrs.chart_type,
		xAxisKey: attrs.x_axis_key,
		xAxisType: attrs.x_axis_type || null,
		series,
		title: attrs.title || '',
	};
}

export function parseTableBlock(attrString: string): ParsedTableBlock | null {
	const attrs = parseChartAttributes(attrString);
	if (!attrs.query_id) {
		return null;
	}

	return {
		queryId: attrs.query_id,
		title: attrs.title || '',
	};
}

export const GRID_CLASSES: Record<number, string> = {
	1: 'grid-cols-1',
	2: 'grid-cols-1 @lg:grid-cols-2',
	3: 'grid-cols-1 @lg:grid-cols-2 @xl:grid-cols-3',
	4: 'grid-cols-1 @lg:grid-cols-2 @xl:grid-cols-3 @2xl:grid-cols-4',
};

export function getGridClass(cols: number): string {
	return GRID_CLASSES[Math.min(cols, 4)] ?? GRID_CLASSES[2];
}

export function splitCodeIntoSegments(code: string): Segment[] {
	const segments: Segment[] = [];
	const blockRegex = /<grid\s+([^>]*)>([\s\S]*?)<\/grid>|<chart\s+([^/>]*)\/?>|<table\s+([^/>]*)\/?>/g;
	let match;
	let lastIndex = 0;

	while ((match = blockRegex.exec(code)) !== null) {
		if (match.index > lastIndex) {
			const md = code.slice(lastIndex, match.index).trim();
			if (md) {
				segments.push({ type: 'markdown', content: md });
			}
		}

		if (match[1] !== undefined && match[2] !== undefined) {
			const gridAttrs = parseChartAttributes(match[1]);
			const cols = parseInt(gridAttrs.cols || '2', 10);
			const gridChildren = splitCodeIntoSegments(match[2]);
			segments.push({ type: 'grid', cols, children: gridChildren });
		} else if (match[3] !== undefined) {
			const chart = parseChartBlock(match[3]);
			if (chart) {
				segments.push({ type: 'chart', chart });
			}
		} else if (match[4] !== undefined) {
			const table = parseTableBlock(match[4]);
			if (table) {
				segments.push({ type: 'table', table });
			}
		}

		lastIndex = match.index + match[0].length;
	}

	if (lastIndex < code.length) {
		const md = code.slice(lastIndex).trim();
		if (md) {
			segments.push({ type: 'markdown', content: md });
		}
	}

	return segments;
}
