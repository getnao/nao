import { buildStoryTableBlock } from './chart-block';
import { type ColumnConditionalFormats, sanitizeConditionalFormats } from './conditional-formatting';

const GRID_SPAN_DIV_PATTERN =
	'<div\\b[^>]*style\\s*=\\s*"[^"]*grid-column\\s*:\\s*span\\s+(\\d+)[^"]*"[^>]*>([\\s\\S]*?)<\\/div>';

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
	hideTotal?: boolean;
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
	| { type: 'grid'; cols: number; widths: number[] | null; children: Segment[] };

export const TAG_ATTRS = String.raw`(?:[^>"']|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')*?`;

export function chartTagRegex(flags = ''): RegExp {
	return new RegExp(String.raw`<chart\s+(${TAG_ATTRS})\/?>`, flags);
}

export function tableTagRegex(flags = ''): RegExp {
	return new RegExp(String.raw`<table\s+(${TAG_ATTRS})\/?>`, flags);
}

export function storyBlockRegex(): RegExp {
	return new RegExp(
		String.raw`<grid(?:\s+(${TAG_ATTRS}))?>([\s\S]*?)<\/grid>|<chart\s+(${TAG_ATTRS})\/?>|<table\s+(${TAG_ATTRS})\/?>`,
		'g',
	);
}

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
		hideTotal: attrs.hide_total === 'true',
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

export function resolveGridWidths(widthsAttr: string | undefined, childCount: number): number[] | null {
	if (widthsAttr === undefined) {
		return null;
	}

	const widths = widthsAttr.split(',').map((value) => Number(value.trim()));
	const isValid = widths.length === childCount && widths.every((width) => Number.isInteger(width) && width > 0);
	return isValid ? widths : null;
}

export function getGridTemplateColumns(widths: number[]): string {
	return widths.map((width) => `${width}fr`).join(' ');
}

export function previewGridColumns(widths: number[], boundaryIndex: number, targetFraction: number): number[] {
	if (widths.length < 2 || boundaryIndex < 0 || boundaryIndex >= widths.length - 1) {
		return widths;
	}

	const total = widths.reduce((sum, width) => sum + width, 0);
	const fractions = widths.map((width) => width / total);
	const previousBoundary = fractions.slice(0, boundaryIndex).reduce((sum, width) => sum + width, 0);
	const nextBoundary = fractions.slice(0, boundaryIndex + 2).reduce((sum, width) => sum + width, 0);
	const minimumFraction = 0.05;
	const clampedTarget = Math.min(
		Math.max(targetFraction, previousBoundary + minimumFraction),
		nextBoundary - minimumFraction,
	);

	fractions[boundaryIndex] = clampedTarget - previousBoundary;
	fractions[boundaryIndex + 1] = nextBoundary - clampedTarget;
	return fractions;
}

export function resizeGridColumns(widths: number[], boundaryIndex: number, targetFraction: number): number[] {
	if (widths.length < 2 || boundaryIndex < 0 || boundaryIndex >= widths.length - 1) {
		return widths;
	}

	const total = widths.reduce((sum, width) => sum + width, 0);
	const cumulativeWidths: number[] = [];
	let runningTotal = 0;
	for (const width of widths) {
		runningTotal += width;
		cumulativeWidths.push(Math.round((runningTotal / total) * 12));
	}
	for (let index = 0; index < cumulativeWidths.length - 1; index++) {
		const minimum = (cumulativeWidths[index - 1] ?? 0) + 1;
		const maximum = 12 - (cumulativeWidths.length - index - 1);
		cumulativeWidths[index] = Math.min(Math.max(cumulativeWidths[index], minimum), maximum);
	}
	cumulativeWidths[cumulativeWidths.length - 1] = 12;

	const previousBoundary = boundaryIndex === 0 ? 0 : cumulativeWidths[boundaryIndex - 1];
	const nextBoundary = cumulativeWidths[boundaryIndex + 1];
	const target = targetFraction * 12;
	const niceBoundaries = [2, 3, 4, 6, 8, 9, 10].filter(
		(boundary) => boundary > previousBoundary && boundary < nextBoundary,
	);
	const candidate =
		niceBoundaries.reduce<number | null>((closest, boundary) => {
			if (closest === null || Math.abs(boundary - target) < Math.abs(closest - target)) {
				return boundary;
			}
			return closest;
		}, null) ?? Math.min(Math.max(Math.round(target), previousBoundary + 1), nextBoundary - 1);

	cumulativeWidths[boundaryIndex] = candidate;
	const resizedWidths = cumulativeWidths.map((boundary, index) => boundary - (cumulativeWidths[index - 1] ?? 0));
	const divisor = resizedWidths.reduce(greatestCommonDivisor);
	return resizedWidths.map((width) => width / divisor);
}

export function setGridColumnsMarkup(rawGridContent: string, widths: number[]): string {
	const gridMatch = rawGridContent.match(/^<grid\b([^>]*)>([\s\S]*)<\/grid>\s*$/);
	if (!gridMatch) {
		return rawGridContent;
	}

	const cleanedInner = gridMatch[2].replace(new RegExp(GRID_SPAN_DIV_PATTERN, 'gi'), '$2').trim();
	const remainingAttributes = gridMatch[1].replace(/\s+(?:widths|cols)\s*=\s*(?:"[^"]*"|'[^']*')/gi, '').trim();
	const extraAttributes = remainingAttributes ? ` ${remainingAttributes}` : '';

	return `<grid widths="${widths.join(',')}"${extraAttributes}>\n${cleanedInner}\n</grid>`;
}

export function splitGridColumnsRaw(rawGridContent: string): { columns: string[]; widths: number[] } {
	const gridMatch = rawGridContent.match(/^<grid\b([^>]*)>([\s\S]*)<\/grid>\s*$/);
	if (!gridMatch) {
		return { columns: [], widths: [] };
	}

	const columns: string[] = [];
	const spans: number[] = [];
	const spanDivRegex = new RegExp(GRID_SPAN_DIV_PATTERN, 'gi');
	let match;
	let lastIndex = 0;

	const addColumns = (content: string, span: number, combineBlocks = false) => {
		const blocks = splitRawStoryBlocks(content);
		if (blocks.length === 0) {
			return;
		}
		if (combineBlocks && blocks.length > 1) {
			columns.push(content.trim());
			spans.push(span);
			return;
		}
		columns.push(...blocks);
		spans.push(...blocks.map(() => span));
	};

	while ((match = spanDivRegex.exec(gridMatch[2])) !== null) {
		addColumns(gridMatch[2].slice(lastIndex, match.index), 1);
		addColumns(match[2], Number(match[1]), true);
		lastIndex = match.index + match[0].length;
	}
	addColumns(gridMatch[2].slice(lastIndex), 1);

	const attrs = parseChartAttributes(gridMatch[1]);
	const resolvedWidths = resolveGridWidths(attrs.widths, columns.length);
	const widths = resolvedWidths ?? (spans.some((span) => span > 1) ? spans : columns.map(() => 1));
	return { columns, widths };
}

export function buildGridMarkup(columns: string[], widths: number[]): string {
	return `<grid widths="${widths.join(',')}">\n${columns.join('\n\n')}\n</grid>`;
}

export function groupBlocksIntoGrid(leftMarkup: string, rightMarkup: string): string {
	return buildGridMarkup([leftMarkup.trim(), rightMarkup.trim()], [1, 1]);
}

export function insertGridColumn(rawGridContent: string, columnMarkup: string, index: number): string {
	const { columns, widths } = splitGridColumnsRaw(rawGridContent);
	if (columns.length === 0) {
		return rawGridContent;
	}

	const existingCount = columns.length;
	const existingSum = widths.reduce((sum, width) => sum + width, 0);
	const scaledExisting = widths.map((width) => width * existingCount);
	const newColumnWidth = existingSum;
	const insertionIndex = Math.min(Math.max(index, 0), columns.length);
	const nextColumns = [...columns];
	nextColumns.splice(insertionIndex, 0, columnMarkup.trim());
	scaledExisting.splice(insertionIndex, 0, newColumnWidth);
	return buildGridMarkup(nextColumns, reduceWidthsByGcd(scaledExisting));
}

export function reorderGridColumns(rawGridContent: string, fromIndex: number, toIndex: number): string {
	const { columns, widths } = splitGridColumnsRaw(rawGridContent);
	if (
		columns.length < 2 ||
		fromIndex < 0 ||
		fromIndex >= columns.length ||
		toIndex < 0 ||
		toIndex >= columns.length ||
		fromIndex === toIndex
	) {
		return rawGridContent;
	}

	const reorderedColumns = [...columns];
	const reorderedWidths = [...widths];
	const [movedColumn] = reorderedColumns.splice(fromIndex, 1);
	const [movedWidth] = reorderedWidths.splice(fromIndex, 1);
	reorderedColumns.splice(toIndex, 0, movedColumn);
	reorderedWidths.splice(toIndex, 0, movedWidth);

	return buildGridMarkup(reorderedColumns, reorderedWidths);
}

export function popGridColumn(
	rawGridContent: string,
	columnIndex: number,
): { remaining: string; popped: string } | null {
	const { columns, widths } = splitGridColumnsRaw(rawGridContent);
	if (columns.length < 2 || columnIndex < 0 || columnIndex >= columns.length) {
		return null;
	}

	const remainingColumns = [...columns];
	const remainingWidths = [...widths];
	const [popped] = remainingColumns.splice(columnIndex, 1);
	remainingWidths.splice(columnIndex, 1);
	const remaining =
		remainingColumns.length >= 2 ? buildGridMarkup(remainingColumns, remainingWidths) : remainingColumns[0];

	return { remaining, popped };
}

function splitRawStoryBlocks(code: string): string[] {
	const blocks: string[] = [];
	const blockRegex = storyBlockRegex();
	let match;
	let lastIndex = 0;

	while ((match = blockRegex.exec(code)) !== null) {
		const markdown = code.slice(lastIndex, match.index).trim();
		if (markdown) {
			blocks.push(markdown);
		}
		blocks.push(match[0].trim());
		lastIndex = match.index + match[0].length;
	}

	const markdown = code.slice(lastIndex).trim();
	if (markdown) {
		blocks.push(markdown);
	}
	return blocks;
}

export function parseGridColumns(inner: string): { children: Segment[]; spans: number[] } {
	const children: Segment[] = [];
	const spans: number[] = [];
	const spanDivRegex = new RegExp(GRID_SPAN_DIV_PATTERN, 'gi');
	let match;
	let lastIndex = 0;

	const addColumns = (content: string, span: number, combineSegments = false) => {
		const segments = splitCodeIntoSegments(content);
		if (segments.length === 0) {
			return;
		}
		if (combineSegments && segments.length > 1) {
			children.push({ type: 'grid', cols: 1, widths: null, children: segments });
			spans.push(span);
			return;
		}
		children.push(...segments);
		spans.push(...segments.map(() => span));
	};

	while ((match = spanDivRegex.exec(inner)) !== null) {
		addColumns(inner.slice(lastIndex, match.index), 1);
		addColumns(match[2], Number(match[1]), true);
		lastIndex = match.index + match[0].length;
	}

	addColumns(inner.slice(lastIndex), 1);
	return { children, spans };
}

function greatestCommonDivisor(left: number, right: number): number {
	let a = Math.abs(left);
	let b = Math.abs(right);
	while (b !== 0) {
		[a, b] = [b, a % b];
	}
	return a;
}

function reduceWidthsByGcd(widths: number[]): number[] {
	const divisor = widths.reduce(greatestCommonDivisor, 0) || 1;
	return widths.map((width) => Math.max(1, Math.round(width / divisor)));
}

export function parseSeriesJsonArray(value: string): unknown[] | null {
	const parsed = tryJsonParse(value) ?? tryJsonParse(escapeStrayBackslashes(value));
	return Array.isArray(parsed) ? parsed : null;
}

function tryJsonParse(value: string): unknown {
	try {
		return JSON.parse(value);
	} catch {
		return null;
	}
}

function escapeStrayBackslashes(value: string): string {
	return value.replace(/\\(?!(?:["\\/bfnrt]|u[0-9a-fA-F]{4}))/g, '\\\\');
}

function tryParseSeriesJson(value: string): ParsedChartBlock['series'] | null {
	return parseSeriesJsonArray(value) as ParsedChartBlock['series'] | null;
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

export function extractQueryIds(code: string): Set<string> {
	const ids = new Set<string>();
	const regex = /<(?:chart|table)\s+[^>]*?\bquery_id\s*=\s*"([^"]+)"/g;
	let match: RegExpExecArray | null;
	while ((match = regex.exec(code)) !== null) {
		ids.add(match[1]);
	}
	return ids;
}

export function splitCodeIntoSegments(code: string): Segment[] {
	const segments: Segment[] = [];
	const blockRegex = storyBlockRegex();
	let match;
	let lastIndex = 0;

	while ((match = blockRegex.exec(code)) !== null) {
		if (match.index > lastIndex) {
			const md = code.slice(lastIndex, match.index).trim();
			if (md) {
				segments.push({ type: 'markdown', content: md });
			}
		}

		if (match[2] !== undefined) {
			const gridAttrs = parseChartAttributes(match[1] ?? '');
			const { children, spans } = parseGridColumns(match[2]);
			const cols = parseInt(gridAttrs.cols || String(children.length || 1), 10);
			const widths =
				gridAttrs.widths !== undefined
					? resolveGridWidths(gridAttrs.widths, children.length)
					: spans.some((span) => span > 1)
						? spans
						: null;
			segments.push({ type: 'grid', cols, widths, children });
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
