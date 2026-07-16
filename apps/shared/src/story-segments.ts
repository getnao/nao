import { buildStoryTableBlock } from './chart-block';
import { type ColumnConditionalFormats, sanitizeConditionalFormats } from './conditional-formatting';

/**
 * Matches a tag's attribute list while treating single/double-quoted values as
 * opaque, so `>` and `/` inside a quoted attribute (e.g. a threshold rule's
 * `">="` operator inside `formatting='{...}'`) do not prematurely terminate the
 * tag. Kept as a shared constant so every block-tag regex stays consistent.
 */
export const TAG_ATTRS = `(?:[^>"']|"(?:[^"\\\\]|\\\\.)*"|'(?:[^'\\\\]|\\\\.)*')*?`;

export interface ParsedChartBlock {
	queryId: string;
	chartType: string;
	xAxisKey: string;
	xAxisType: string | null;
	series: Array<{ data_key: string; color: string; label?: string; is_total?: boolean }>;
	yAxisMin?: number;
	yAxisMax?: number;
	title: string;
	showDataLabels?: boolean;
	/** The original `<chart ... />` tag this block was parsed from, when available. */
	rawTag?: string;
}

export interface ParsedTableBlock {
	queryId: string;
	title: string;
	conditionalFormats?: ColumnConditionalFormats;
	/** The original `<table ... />` tag this block was parsed from, when available. */
	rawTag?: string;
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
		const parsed = tryParseSeriesJson(attrs.series) ?? extractSeriesFromRawAttrs(attrString);
		if (parsed) {
			series.push(...parsed);
		}
	} else if (attrs.data_key) {
		series.push({
			data_key: attrs.data_key,
			color: attrs.color || 'var(--chart-1)',
			label: attrs.label,
		});
	}

	const yAxisMin = parseOptionalNumberAttr(attrs.y_axis_min);
	const yAxisMax = parseOptionalNumberAttr(attrs.y_axis_max);

	return {
		queryId: attrs.query_id,
		chartType: attrs.chart_type,
		xAxisKey: attrs.x_axis_key,
		xAxisType: attrs.x_axis_type || null,
		series,
		yAxisMin,
		yAxisMax,
		title: attrs.title || '',
		showDataLabels: attrs.show_data_labels === 'true',
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
		conditionalFormats: parseConditionalFormats(attrs.formatting),
	};
}

function parseConditionalFormats(value: string | undefined): ColumnConditionalFormats | undefined {
	if (!value) {
		return undefined;
	}
	try {
		return sanitizeConditionalFormats(JSON.parse(value));
	} catch {
		return undefined;
	}
}

/**
 * Injects `formatting='…'` into every `<table query_id="…" />` block that lacks
 * an explicit `formatting` attribute, using `formatsByQueryId`. Tables that
 * already declare formatting are left untouched, so agent-authored formatting
 * always wins over the carried-over defaults.
 */
export function injectTableFormatting(
	code: string,
	formatsByQueryId: Record<string, ColumnConditionalFormats>,
): string {
	if (Object.keys(formatsByQueryId).length === 0) {
		return code;
	}

	const tableRegex = new RegExp(`<table\\s+${TAG_ATTRS}\\/?>`, 'g');
	return code.replace(tableRegex, (fullTag) => {
		const attrString = fullTag.replace(/^<table\s+/, '').replace(/\/?>$/, '');
		const attrs = parseChartAttributes(attrString);
		if (!attrs.query_id || attrs.formatting) {
			return fullTag;
		}

		const conditionalFormats = formatsByQueryId[attrs.query_id];
		if (!conditionalFormats || Object.keys(conditionalFormats).length === 0) {
			return fullTag;
		}

		return buildStoryTableBlock({
			query_id: attrs.query_id,
			title: attrs.title || undefined,
			conditional_formats: conditionalFormats,
		});
	});
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

function tryParseSeriesJson(value: string): ParsedChartBlock['series'] | null {
	try {
		const parsed = JSON.parse(value);
		return Array.isArray(parsed) ? parsed : null;
	} catch {
		return null;
	}
}

function parseOptionalNumberAttr(value: string | undefined): number | undefined {
	return value !== undefined && value !== '' && Number.isFinite(Number(value)) ? Number(value) : undefined;
}

function extractSeriesFromRawAttrs(attrString: string): ParsedChartBlock['series'] | null {
	const seriesIdx = attrString.search(/\bseries\s*=/);
	if (seriesIdx === -1) {
		return null;
	}

	const bracketStart = attrString.indexOf('[', seriesIdx);
	if (bracketStart === -1) {
		return null;
	}

	let depth = 0;
	for (let i = bracketStart; i < attrString.length; i++) {
		if (attrString[i] === '[') {
			depth++;
		} else if (attrString[i] === ']') {
			depth--;
			if (depth === 0) {
				return tryParseSeriesJson(attrString.slice(bracketStart, i + 1));
			}
		}
	}
	return null;
}

export function splitCodeIntoSegments(code: string): Segment[] {
	const segments: Segment[] = [];
	const blockRegex = new RegExp(
		`<grid\\s+([^>]*)>([\\s\\S]*?)<\\/grid>|<chart\\s+(${TAG_ATTRS})\\/?>|<table\\s+(${TAG_ATTRS})\\/?>`,
		'g',
	);
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
				segments.push({ type: 'chart', chart: { ...chart, rawTag: match[0] } });
			}
		} else if (match[4] !== undefined) {
			const table = parseTableBlock(match[4]);
			if (table) {
				segments.push({ type: 'table', table: { ...table, rawTag: match[0] } });
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
