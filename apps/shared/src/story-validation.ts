import { STORY_FILTER_ID_REGEX, STORY_FILTER_TYPES } from './sql-template';
import {
	parseChartAttributes,
	parseGridColumns,
	parseSeriesJsonArray,
	parseStringArrayAttribute,
	TAG_ATTRS,
} from './story-segments';
import { ChartTypeEnum, SeriesTypeEnum, XAxisTypeEnum, YAxisSideEnum } from './tools/display-chart';

export interface StoryValidationError {
	message: string;
	line: number;
	column: number;
	length: number;
}

const REQUIRED_CHART_ATTRS = ['query_id', 'chart_type', 'x_axis_key'] as const;
const CHART_TYPES_WITHOUT_X_AXIS_KEY = new Set(['kpi_card']);
const REQUIRED_TABLE_ATTRS = ['query_id'] as const;
const REQUIRED_FILTER_ATTRS = ['id', 'type'] as const;

const VALID_CHART_TYPES = new Set<string>(ChartTypeEnum.options);

const VALID_X_AXIS_TYPES = new Set<string>(XAxisTypeEnum.options);

const VALID_SERIES_TYPES = new Set<string>(SeriesTypeEnum.options);

const VALID_Y_AXIS_SIDES = new Set<string>(YAxisSideEnum.options);

/**
 * Validates the structure of a story's markdown code, looking for common
 * authoring mistakes in <chart />, <table /> and <grid> blocks.
 *
 * Returns a list of errors with 1-based line/column coordinates suitable for
 * driving Monaco editor markers.
 */
export function validateStoryCode(code: string): StoryValidationError[] {
	const errors: StoryValidationError[] = [];

	errors.push(...validateGridBlocks(code));
	errors.push(...validateChartBlocks(code));
	errors.push(...validateTableBlocks(code));
	errors.push(...validateFilterBlocks(code));
	errors.push(...validateTabsBlocks(code));
	errors.push(...validateUnterminatedTags(code));

	return errors.sort((a, b) => a.line - b.line || a.column - b.column);
}

function validateTabsBlocks(code: string): StoryValidationError[] {
	const errors: StoryValidationError[] = [];
	const tabOpeners = [...code.matchAll(new RegExp(`<tab\\b(${TAG_ATTRS})?>`, 'g'))];
	if (tabOpeners.length === 0) {
		return errors;
	}

	const tabBlocks: Array<{ start: number; end: number }> = [];
	for (let index = 0; index < tabOpeners.length; index++) {
		const opener = tabOpeners[index];
		const openerEnd = opener.index + opener[0].length;
		const closeIndex = code.indexOf('</tab>', openerEnd);
		const nextOpenerIndex = tabOpeners[index + 1]?.index ?? code.length;
		if (closeIndex === -1 || nextOpenerIndex < closeIndex) {
			const position = getPosition(code, opener.index);
			errors.push({
				message: '<tab> tag is missing a matching </tab> closing tag.',
				line: position.line,
				column: position.column,
				length: opener[0].length,
			});
			continue;
		}

		tabBlocks.push({ start: opener.index, end: closeIndex + '</tab>'.length });
		const attrs = parseChartAttributes(opener[0]);
		if (!attrs.title?.trim()) {
			const position = getPosition(code, opener.index);
			errors.push({
				message: 'Tab is missing a required `title` attribute.',
				line: position.line,
				column: position.column,
				length: opener[0].length,
			});
		}
	}

	let contentCursor = 0;
	for (const tabBlock of tabBlocks) {
		const outsideOffset = code.slice(contentCursor, tabBlock.start).search(/\S/);
		if (outsideOffset !== -1) {
			const codeOffset = contentCursor + outsideOffset;
			const position = getPosition(code, codeOffset);
			errors.push({
				message: 'Content is not allowed outside <tab> blocks — a tabbed story must contain only <tab> blocks.',
				line: position.line,
				column: position.column,
				length: getLineContentLength(code, codeOffset),
			});
			return errors;
		}
		contentCursor = tabBlock.end;
	}

	const outsideOffset = code.slice(contentCursor).search(/\S/);
	if (outsideOffset !== -1) {
		const codeOffset = contentCursor + outsideOffset;
		const position = getPosition(code, codeOffset);
		errors.push({
			message: 'Content is not allowed outside <tab> blocks — a tabbed story must contain only <tab> blocks.',
			line: position.line,
			column: position.column,
			length: getLineContentLength(code, codeOffset),
		});
	}

	return errors;
}

function validateChartBlocks(code: string): StoryValidationError[] {
	const errors: StoryValidationError[] = [];
	const chartRegex = new RegExp(String.raw`<chart\b(${TAG_ATTRS})(\/?)>`, 'g');
	let match: RegExpExecArray | null;

	while ((match = chartRegex.exec(code)) !== null) {
		const [fullMatch, attrString, slash] = match;
		const position = getPosition(code, match.index);
		const attrs = parseChartAttributes(attrString ?? '');

		if (slash !== '/') {
			errors.push({
				message: '<chart> tag must be self-closing — use "/>" instead of ">".',
				line: position.line,
				column: position.column,
				length: fullMatch.length,
			});
		}

		const missing = REQUIRED_CHART_ATTRS.filter(
			(attr) => !attrs[attr] && !(attr === 'x_axis_key' && CHART_TYPES_WITHOUT_X_AXIS_KEY.has(attrs.chart_type)),
		);
		if (missing.length > 0) {
			errors.push({
				message: `Chart is missing required attribute${missing.length === 1 ? '' : 's'}: ${missing.join(', ')}.`,
				line: position.line,
				column: position.column,
				length: fullMatch.length,
			});
		}

		if (attrs.chart_type && !VALID_CHART_TYPES.has(attrs.chart_type)) {
			errors.push({
				message: `Invalid chart_type "${attrs.chart_type}". Valid types: ${[...VALID_CHART_TYPES].join(', ')}.`,
				line: position.line,
				column: position.column,
				length: fullMatch.length,
			});
		}

		if (attrs.x_axis_type && !VALID_X_AXIS_TYPES.has(attrs.x_axis_type)) {
			errors.push({
				message: `Invalid x_axis_type "${attrs.x_axis_type}". Valid values: ${[...VALID_X_AXIS_TYPES].join(', ')}.`,
				line: position.line,
				column: position.column,
				length: fullMatch.length,
			});
		}

		const seriesError = validateChartSeries(attrs, position, fullMatch.length);
		if (seriesError) {
			errors.push(seriesError);
		}
	}

	return errors;
}

function validateChartSeries(
	attrs: Record<string, string>,
	position: { line: number; column: number },
	length: number,
): StoryValidationError | null {
	if (attrs.series === undefined && attrs.data_key === undefined) {
		return {
			message: 'Chart must define either a `series=[...]` array or a `data_key` attribute.',
			line: position.line,
			column: position.column,
			length,
		};
	}

	if (attrs.series === undefined) {
		return null;
	}

	const parsed = parseSeriesJsonArray(attrs.series);

	if (parsed === null) {
		return {
			message: 'Chart `series` attribute must be a valid JSON array.',
			line: position.line,
			column: position.column,
			length,
		};
	}

	if (parsed.length === 0) {
		return {
			message: 'Chart `series` attribute must be a non-empty JSON array.',
			line: position.line,
			column: position.column,
			length,
		};
	}

	for (const item of parsed) {
		if (!item || typeof item !== 'object' || typeof (item as { data_key?: unknown }).data_key !== 'string') {
			return {
				message: 'Each chart series entry must be an object with a string `data_key` property.',
				line: position.line,
				column: position.column,
				length,
			};
		}

		const { series_type: seriesType, y_axis: yAxis } = item as { series_type?: unknown; y_axis?: unknown };
		if (seriesType !== undefined && !VALID_SERIES_TYPES.has(seriesType as string)) {
			return {
				message: `Invalid series \`series_type\` "${String(seriesType)}". Valid values: ${[...VALID_SERIES_TYPES].join(', ')}.`,
				line: position.line,
				column: position.column,
				length,
			};
		}
		if (yAxis !== undefined && !VALID_Y_AXIS_SIDES.has(yAxis as string)) {
			return {
				message: `Invalid series \`y_axis\` "${String(yAxis)}". Valid values: ${[...VALID_Y_AXIS_SIDES].join(', ')}.`,
				line: position.line,
				column: position.column,
				length,
			};
		}
	}

	return null;
}

function validateTableBlocks(code: string): StoryValidationError[] {
	const errors: StoryValidationError[] = [];
	const tableRegex = new RegExp(String.raw`<table\b(${TAG_ATTRS})(\/?)>`, 'g');
	let match: RegExpExecArray | null;

	while ((match = tableRegex.exec(code)) !== null) {
		const [fullMatch, attrString, slash] = match;
		if (isMarkdownTable(code, match.index)) {
			continue;
		}
		const position = getPosition(code, match.index);
		const attrs = parseChartAttributes(attrString ?? '');

		if (slash !== '/') {
			errors.push({
				message: '<table> tag must be self-closing — use "/>" instead of ">".',
				line: position.line,
				column: position.column,
				length: fullMatch.length,
			});
		}

		const missing = REQUIRED_TABLE_ATTRS.filter((attr) => !attrs[attr]);
		if (missing.length > 0) {
			errors.push({
				message: `Table is missing required attribute${missing.length === 1 ? '' : 's'}: ${missing.join(', ')}.`,
				line: position.line,
				column: position.column,
				length: fullMatch.length,
			});
		}
	}

	return errors;
}

function validateFilterBlocks(code: string): StoryValidationError[] {
	const errors: StoryValidationError[] = [];
	const filterRegex = new RegExp(String.raw`<filter\b(${TAG_ATTRS})(\/?)>`, 'g');
	const filterIds = new Set<string>();
	let match: RegExpExecArray | null;

	while ((match = filterRegex.exec(code)) !== null) {
		const [fullMatch, attrString, slash] = match;
		const position = getPosition(code, match.index);
		const attrs = parseChartAttributes(attrString ?? '');

		if (slash !== '/') {
			errors.push({
				message: '<filter> tag must be self-closing — use "/>" instead of ">".',
				line: position.line,
				column: position.column,
				length: fullMatch.length,
			});
		}

		const missing = REQUIRED_FILTER_ATTRS.filter((attr) => !attrs[attr]);
		if (missing.length > 0) {
			errors.push({
				message: `Filter is missing required attribute${missing.length === 1 ? '' : 's'}: ${missing.join(', ')}.`,
				line: position.line,
				column: position.column,
				length: fullMatch.length,
			});
		}

		if (attrs.type && !STORY_FILTER_TYPES.includes(attrs.type as (typeof STORY_FILTER_TYPES)[number])) {
			errors.push({
				message: `Invalid filter type "${attrs.type}". Valid types: ${STORY_FILTER_TYPES.join(', ')}.`,
				line: position.line,
				column: position.column,
				length: fullMatch.length,
			});
		}

		if (attrs.id && !STORY_FILTER_ID_REGEX.test(attrs.id)) {
			errors.push({
				message: `Invalid filter id "${attrs.id}". Use letters, numbers, and underscores, starting with a letter or underscore.`,
				line: position.line,
				column: position.column,
				length: fullMatch.length,
			});
		}

		const options = parseStringArrayAttribute(attrs.options);
		if (attrs.options !== undefined && options === undefined) {
			errors.push({
				message: 'Filter `options` attribute must be a valid JSON array of strings.',
				line: position.line,
				column: position.column,
				length: fullMatch.length,
			});
		}

		const needsOptionsSource = attrs.type === 'select' || attrs.type === 'multi_select';
		if (needsOptionsSource) {
			const hasHardcodedOptions = Boolean(options?.length);
			const hasTableSource = Boolean(attrs.table && attrs.column);
			if (!hasHardcodedOptions && !hasTableSource) {
				errors.push({
					message:
						'Select filters require either `options=\'["a","b"]\'` or both `table` and `column` attributes.',
					line: position.line,
					column: position.column,
					length: fullMatch.length,
				});
			}
		}

		if (attrs.id && filterIds.has(attrs.id)) {
			errors.push({
				message: `Filter id "${attrs.id}" must be unique within the story.`,
				line: position.line,
				column: position.column,
				length: fullMatch.length,
			});
		}
		if (attrs.id) {
			filterIds.add(attrs.id);
		}
	}

	return errors;
}

function isMarkdownTable(code: string, index: number): boolean {
	const lineStart = code.lastIndexOf('\n', index - 1) + 1;
	const linePrefix = code.slice(lineStart, index);
	const lineEnd = code.indexOf('\n', index);
	const currentLine = code.slice(lineStart, lineEnd === -1 ? code.length : lineEnd);
	return /^\s*\|/.test(linePrefix) || (/\|\s*$/.test(linePrefix) && /\|/.test(currentLine.slice(index - lineStart)));
}

function validateGridBlocks(code: string): StoryValidationError[] {
	const errors: StoryValidationError[] = [];
	const openTagRegex = /<grid\b([^>]*)>/g;
	let match: RegExpExecArray | null;

	while ((match = openTagRegex.exec(code)) !== null) {
		const position = getPosition(code, match.index);
		const closeIdx = findMatchingClose(code, openTagRegex.lastIndex);
		if (closeIdx === -1) {
			errors.push({
				message: '<grid> tag is missing a matching </grid> closing tag.',
				line: position.line,
				column: position.column,
				length: match[0].length,
			});
			continue;
		}

		const attrs = parseChartAttributes(match[1] ?? '');
		if (attrs.cols !== undefined) {
			const cols = Number(attrs.cols);
			if (!Number.isInteger(cols) || cols < 1 || cols > 4) {
				errors.push({
					message: `Grid \`cols\` must be an integer between 1 and 4 (got "${attrs.cols}").`,
					line: position.line,
					column: position.column,
					length: match[0].length,
				});
			}
		}

		if (attrs.widths !== undefined) {
			const widthValues = attrs.widths.split(',');
			const hasInvalidWidth = widthValues.some((value) => {
				const width = Number(value.trim());
				return !Number.isInteger(width) || width <= 0;
			});
			if (hasInvalidWidth) {
				errors.push({
					message: 'Grid `widths` must be a comma-separated list of positive integers.',
					line: position.line,
					column: position.column,
					length: match[0].length,
				});
			}

			const innerContent = code.slice(openTagRegex.lastIndex, closeIdx);
			const childCount = parseGridColumns(innerContent).children.length;
			if (widthValues.length !== childCount) {
				errors.push({
					message: `Grid \`widths\` has ${widthValues.length} values but the grid has ${childCount} columns.`,
					line: position.line,
					column: position.column,
					length: match[0].length,
				});
			}
		}
	}

	return errors;
}

function findMatchingClose(code: string, startIndex: number): number {
	let depth = 1;
	let index = startIndex;
	const openRegex = /<grid\b[^>]*>/g;
	const closeRegex = /<\/grid\s*>/g;
	openRegex.lastIndex = index;
	closeRegex.lastIndex = index;

	while (depth > 0) {
		openRegex.lastIndex = index;
		closeRegex.lastIndex = index;
		const next = openRegex.exec(code);
		const close = closeRegex.exec(code);
		if (!close) {
			return -1;
		}
		if (next && next.index < close.index) {
			depth++;
			index = next.index + next[0].length;
		} else {
			depth--;
			index = close.index + close[0].length;
			if (depth === 0) {
				return close.index;
			}
		}
	}
	return -1;
}

function validateUnterminatedTags(code: string): StoryValidationError[] {
	const errors: StoryValidationError[] = [];
	const tagRegex = /<(chart|table|filter)\b[^>]*$/gm;
	let match: RegExpExecArray | null;

	while ((match = tagRegex.exec(code)) !== null) {
		if (match[0].includes('>')) {
			continue;
		}
		const position = getPosition(code, match.index);
		errors.push({
			message: `<${match[1]}> tag is not properly closed — did you forget "/>"?`,
			line: position.line,
			column: position.column,
			length: match[0].length,
		});
	}

	return errors;
}

function getPosition(code: string, offset: number): { line: number; column: number } {
	let line = 1;
	let column = 1;
	for (let i = 0; i < offset; i++) {
		if (code[i] === '\n') {
			line++;
			column = 1;
		} else {
			column++;
		}
	}
	return { line, column };
}

function getLineContentLength(code: string, offset: number): number {
	const lineEnd = code.indexOf('\n', offset);
	return Math.max(1, (lineEnd === -1 ? code.length : lineEnd) - offset);
}
