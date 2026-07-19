import { parseChartAttributes, TAG_ATTRS } from './story-segments';

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
	'stacked_bar_100',
	'line',
	'area',
	'stacked_area',
	'stacked_area_100',
	'pie',
	'donut',
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
	errors.push(...validateTabsBlocks(code));
	errors.push(...validateUnterminatedTags(code));

	return errors.sort((a, b) => a.line - b.line || a.column - b.column);
}

function validateTabsBlocks(code: string): StoryValidationError[] {
	const errors: StoryValidationError[] = [];
	const tabsOpenRegex = /<tabs\b[^>]*>/g;
	const tabsOpeners = [...code.matchAll(tabsOpenRegex)];
	const firstTabsOpener = tabsOpeners[0];

	if (!firstTabsOpener) {
		const tabOpenRegex = /<tab\b[^>]*>/g;
		let tabMatch: RegExpExecArray | null;
		while ((tabMatch = tabOpenRegex.exec(code)) !== null) {
			const position = getPosition(code, tabMatch.index);
			errors.push({
				message: '<tab> can only be used inside a <tabs> block.',
				line: position.line,
				column: position.column,
				length: tabMatch[0].length,
			});
		}
		return errors;
	}

	const tabsStart = firstTabsOpener.index;
	const tabsContentStart = tabsStart + firstTabsOpener[0].length;
	const contentBeforeOffset = code.slice(0, tabsStart).search(/\S/);
	if (contentBeforeOffset !== -1) {
		const position = getPosition(code, contentBeforeOffset);
		errors.push({
			message: 'Content is not allowed before <tabs> — a tabbed story must start with <tabs>.',
			line: position.line,
			column: position.column,
			length: getLineContentLength(code, contentBeforeOffset),
		});
	}

	for (const extraTabsOpener of tabsOpeners.slice(1)) {
		const position = getPosition(code, extraTabsOpener.index);
		errors.push({
			message: 'Only one <tabs> block is allowed per story.',
			line: position.line,
			column: position.column,
			length: extraTabsOpener[0].length,
		});
	}

	const tabsCloseIndex = code.indexOf('</tabs>', tabsContentStart);
	const tabsContentEnd = tabsCloseIndex === -1 ? code.length : tabsCloseIndex;
	if (tabsCloseIndex !== -1) {
		const afterTabsStart = tabsCloseIndex + '</tabs>'.length;
		const contentAfterRelativeOffset = code.slice(afterTabsStart).search(/\S/);
		if (contentAfterRelativeOffset !== -1) {
			const contentAfterOffset = afterTabsStart + contentAfterRelativeOffset;
			const position = getPosition(code, contentAfterOffset);
			errors.push({
				message: 'Content is not allowed after </tabs>.',
				line: position.line,
				column: position.column,
				length: getLineContentLength(code, contentAfterOffset),
			});
		}
	}

	const tabsContent = code.slice(tabsContentStart, tabsContentEnd);
	const tabRegex = new RegExp(`<tab\\b(${TAG_ATTRS})?>([\\s\\S]*?)<\\/tab>`, 'g');
	const tabBlocks: Array<{ start: number; end: number }> = [];
	let tabMatch: RegExpExecArray | null;
	while ((tabMatch = tabRegex.exec(tabsContent)) !== null) {
		const tabOffset = tabsContentStart + tabMatch.index;
		tabBlocks.push({ start: tabMatch.index, end: tabRegex.lastIndex });
		const attrs = parseChartAttributes(tabMatch[1] ?? '');
		if (!attrs.title?.trim()) {
			const position = getPosition(code, tabOffset);
			errors.push({
				message: 'Tab is missing a required `title` attribute.',
				line: position.line,
				column: position.column,
				length: tabMatch[0].indexOf('>') + 1,
			});
		}
	}

	const tabOpenRegex = /<tab\b[^>]*>/g;
	const tabOpeners = [...tabsContent.matchAll(tabOpenRegex)];
	for (let index = 0; index < tabOpeners.length; index++) {
		const opener = tabOpeners[index];
		const openerEnd = opener.index + opener[0].length;
		const closeIndex = tabsContent.indexOf('</tab>', openerEnd);
		const nextOpenerIndex = tabOpeners[index + 1]?.index ?? tabsContent.length;
		if (closeIndex === -1 || nextOpenerIndex < closeIndex) {
			const position = getPosition(code, tabsContentStart + opener.index);
			errors.push({
				message: '<tab> tag is missing a matching </tab> closing tag.',
				line: position.line,
				column: position.column,
				length: opener[0].length,
			});
		}
	}

	let contentCursor = 0;
	for (const tabBlock of tabBlocks) {
		const outsideOffset = tabsContent.slice(contentCursor, tabBlock.start).search(/\S/);
		if (outsideOffset !== -1) {
			const codeOffset = tabsContentStart + contentCursor + outsideOffset;
			const position = getPosition(code, codeOffset);
			errors.push({
				message: 'Content is not allowed outside <tab> inside a <tabs> block.',
				line: position.line,
				column: position.column,
				length: getLineContentLength(code, codeOffset),
			});
			return errors;
		}
		contentCursor = tabBlock.end;
	}

	const outsideOffset = tabsContent.slice(contentCursor).search(/\S/);
	if (outsideOffset !== -1) {
		const codeOffset = tabsContentStart + contentCursor + outsideOffset;
		const position = getPosition(code, codeOffset);
		errors.push({
			message: 'Content is not allowed outside <tab> inside a <tabs> block.',
			line: position.line,
			column: position.column,
			length: getLineContentLength(code, codeOffset),
		});
	}

	return errors;
}

function validateChartBlocks(code: string): StoryValidationError[] {
	const errors: StoryValidationError[] = [];
	const chartRegex = new RegExp(`<chart\\b(${TAG_ATTRS})(\\/?)>`, 'g');
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
	const tableRegex = new RegExp(`<table\\b(${TAG_ATTRS})(\\/?)>`, 'g');
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

function getLineContentLength(code: string, offset: number): number {
	const lineEnd = code.indexOf('\n', offset);
	return Math.max(1, (lineEnd === -1 ? code.length : lineEnd) - offset);
}
