import { parseChartAttributes } from './story-segments';

export interface StoryValidationError {
	message: string;
	line: number;
	column: number;
	length: number;
}

const REQUIRED_CHART_ATTRS = ['query_id', 'chart_type', 'x_axis_key'] as const;
const REQUIRED_TABLE_ATTRS = ['query_id'] as const;

const VALID_CHART_TYPES = new Set([
	'bar',
	'stacked_bar',
	'line',
	'area',
	'stacked_area',
	'pie',
	'kpi_card',
	'scatter',
	'radar',
]);

const VALID_X_AXIS_TYPES = new Set(['date', 'number', 'category']);

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
	errors.push(...validateUnterminatedTags(code));

	return errors.sort((a, b) => a.line - b.line || a.column - b.column);
}

function validateChartBlocks(code: string): StoryValidationError[] {
	const errors: StoryValidationError[] = [];
	const chartRegex = /<chart\b([^/>]*?)(\/?)>/g;
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

		const missing = REQUIRED_CHART_ATTRS.filter((attr) => !attrs[attr]);
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

		const seriesError = validateChartSeries(attrs, attrString ?? '', position, fullMatch.length);
		if (seriesError) {
			errors.push(seriesError);
		}
	}

	return errors;
}

function validateChartSeries(
	attrs: Record<string, string>,
	attrString: string,
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

	const rawSeries = extractRawSeriesBracket(attrString);
	const jsonSource = rawSeries ?? attrs.series;

	let parsed: unknown;
	try {
		parsed = JSON.parse(jsonSource);
	} catch {
		return {
			message: 'Chart `series` attribute must be a valid JSON array.',
			line: position.line,
			column: position.column,
			length,
		};
	}

	if (!Array.isArray(parsed) || parsed.length === 0) {
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
	}

	return null;
}

function extractRawSeriesBracket(attrString: string): string | null {
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
				return attrString.slice(bracketStart, i + 1);
			}
		}
	}
	return null;
}

function validateTableBlocks(code: string): StoryValidationError[] {
	const errors: StoryValidationError[] = [];
	const tableRegex = /<table\b([^/>]*?)(\/?)>/g;
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
	const tagRegex = /<(chart|table)\b[^>]*$/gm;
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
