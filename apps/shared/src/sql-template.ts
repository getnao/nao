export const STORY_FILTER_TYPES = ['select', 'multi_select', 'search', 'date_range'] as const;

export type StoryFilterType = (typeof STORY_FILTER_TYPES)[number];

export type StoryFilterSelection = string | string[];

export type StoryFilterSelections = Record<string, StoryFilterSelection>;

export type StoryFilterTypeById = Record<string, StoryFilterType>;

export const STORY_FILTER_ID_REGEX = /^[A-Za-z_][A-Za-z0-9_]*$/;

const FILTER_BLOCK_REGEX = /\{%\s*filter\s+([A-Za-z_][A-Za-z0-9_]*)\s*%\}([\s\S]*?)\{%\s*endfilter\s*%\}/g;
const FILTER_PLACEHOLDER_REGEX = /\{\{\s*filters\.([A-Za-z_][A-Za-z0-9_]*)\.sql\s*\}\}/g;
const ANY_FILTER_PLACEHOLDER_REGEX = /\{\{\s*filters\.([^\s.{}]+)(?:\.([^\s{}]*))?\s*\}\}/g;
const FILTER_OPEN_REGEX = /\{%\s*filter\b[^%}]*%\}/g;
const FILTER_CLOSE_REGEX = /\{%\s*endfilter\s*%\}/g;
const FILTER_DELIMITER_REGEX = /\{%\s*(?:filter\b([^%}]*)|(endfilter))\s*%\}/g;

const INVALID_PLACEHOLDER_HINTS: Record<string, string> = {
	start: "date_range exposes a single {{ filters.<id>.sql }} value that already expands to 'start' AND 'end' — use AND col BETWEEN {{ filters.<id>.sql }}",
	end: "date_range exposes a single {{ filters.<id>.sql }} value that already expands to 'start' AND 'end' — use AND col BETWEEN {{ filters.<id>.sql }}",
	from: "date_range exposes a single {{ filters.<id>.sql }} value that already expands to 'start' AND 'end' — use AND col BETWEEN {{ filters.<id>.sql }}",
	to: "date_range exposes a single {{ filters.<id>.sql }} value that already expands to 'start' AND 'end' — use AND col BETWEEN {{ filters.<id>.sql }}",
	value: 'use {{ filters.<id>.sql }} (the only supported placeholder property)',
};

export function stripSqlFilterBlocks(sql: string): string {
	const ranges: Array<{ start: number; end: number }> = [];
	const openers: Array<{ start: number }> = [];

	for (const delimiter of getFilterDelimiters(sql)) {
		if (delimiter.kind === 'open') {
			openers.push(delimiter);
			continue;
		}

		const opener = openers.pop();
		if (!opener) {
			ranges.push({ start: delimiter.start, end: delimiter.end });
			continue;
		}
		if (openers.length === 0) {
			ranges.push({ start: opener.start, end: delimiter.end });
		}
	}

	for (const opener of openers) {
		ranges.push({ start: opener.start, end: sql.length });
	}

	return removeRanges(sql, ranges);
}

export function extractSqlFilterIds(sql: string): string[] {
	const ids: string[] = [];
	const seen = new Set<string>();
	const regex = new RegExp(FILTER_BLOCK_REGEX.source, 'g');
	let match: RegExpExecArray | null;
	while ((match = regex.exec(sql)) !== null) {
		const id = match[1];
		if (!seen.has(id)) {
			seen.add(id);
			ids.push(id);
		}
	}
	return ids;
}

/**
 * Validates story-filter SQL template syntax.
 * Returns human-readable issues the agent can use to self-heal incorrect templates.
 */
export function validateSqlFilterTemplate(sql: string, options?: { knownFilterIds?: Iterable<string> }): string[] {
	if (!sqlIncludesFilterTemplate(sql)) {
		return [];
	}

	const issues: string[] = [];
	const knownFilterIds = options?.knownFilterIds ? new Set(options.knownFilterIds) : null;

	const openCount = countMatches(sql, FILTER_OPEN_REGEX);
	const closeCount = countMatches(sql, FILTER_CLOSE_REGEX);
	if (openCount !== closeCount) {
		issues.push(
			`Mismatched filter blocks: found ${openCount} "{% filter %}" opener(s) and ${closeCount} "{% endfilter %}" closer(s).`,
		);
	}
	issues.push(...validateFilterDelimiterOrder(sql));

	const blockRegex = new RegExp(FILTER_BLOCK_REGEX.source, 'g');
	const coveredRanges: Array<{ start: number; end: number }> = [];
	let blockMatch: RegExpExecArray | null;
	while ((blockMatch = blockRegex.exec(sql)) !== null) {
		const filterId = blockMatch[1];
		const inner = blockMatch[2];
		const blockStart = blockMatch.index;
		const blockEnd = blockMatch.index + blockMatch[0].length;
		coveredRanges.push({ start: blockStart, end: blockEnd });

		if (knownFilterIds && !knownFilterIds.has(filterId)) {
			issues.push(
				`SQL references undeclared filter "${filterId}". Add <filter id="${filterId}" ... /> to the story, or fix the filter id in the SQL template.`,
			);
		}

		const placeholders = [...inner.matchAll(new RegExp(ANY_FILTER_PLACEHOLDER_REGEX.source, 'g'))];
		if (placeholders.length === 0) {
			issues.push(
				`Filter block "${filterId}" is missing {{ filters.${filterId}.sql }}. Example: {% filter ${filterId} %} AND col = {{ filters.${filterId}.sql }} {% endfilter %}.`,
			);
			continue;
		}

		for (const placeholder of placeholders) {
			const placeholderId = placeholder[1];
			const property = placeholder[2];
			issues.push(...describePlaceholderIssues(placeholder[0], placeholderId, property, filterId));
		}
	}

	const outsidePlaceholderRegex = new RegExp(ANY_FILTER_PLACEHOLDER_REGEX.source, 'g');
	let placeholderMatch: RegExpExecArray | null;
	while ((placeholderMatch = outsidePlaceholderRegex.exec(sql)) !== null) {
		const start = placeholderMatch.index;
		const end = start + placeholderMatch[0].length;
		if (coveredRanges.some((range) => start >= range.start && end <= range.end)) {
			continue;
		}

		const placeholderId = placeholderMatch[1];
		const property = placeholderMatch[2];
		issues.push(
			`Placeholder ${placeholderMatch[0]} must appear inside {% filter ${placeholderId} %} ... {% endfilter %}.`,
		);
		issues.push(...describePlaceholderIssues(placeholderMatch[0], placeholderId, property, placeholderId));
	}

	return uniqueIssues(issues);
}

/** Returns declared filter ids that never appear in any of the provided SQL templates. */
export function findUnreferencedStoryFilters(
	declaredFilterIds: Iterable<string>,
	sqlQueries: Iterable<string>,
): string[] {
	const referenced = new Set<string>();
	for (const sql of sqlQueries) {
		for (const filterId of extractSqlFilterIds(sql)) {
			referenced.add(filterId);
		}
		const placeholderRegex = new RegExp(ANY_FILTER_PLACEHOLDER_REGEX.source, 'g');
		let match: RegExpExecArray | null;
		while ((match = placeholderRegex.exec(sql)) !== null) {
			referenced.add(match[1]);
		}
	}

	return [...declaredFilterIds].filter((filterId) => !referenced.has(filterId));
}

export function sqlIncludesFilterTemplate(sql: string): boolean {
	return /\{%\s*(?:filter|endfilter)\b/.test(sql) || /\{\{\s*filters\./.test(sql);
}

function describePlaceholderIssues(
	raw: string,
	placeholderId: string,
	property: string | undefined,
	expectedFilterId: string,
): string[] {
	const issues: string[] = [];

	if (placeholderId !== expectedFilterId) {
		issues.push(
			`Filter block "${expectedFilterId}" contains placeholder for unrelated filter "${placeholderId}". Use {{ filters.${expectedFilterId}.sql }}.`,
		);
	}

	if (!property) {
		issues.push(
			`Invalid placeholder ${raw}. Use {{ filters.${placeholderId}.sql }} (property ".sql" is required).`,
		);
		return issues;
	}

	if (property === 'sql') {
		return issues;
	}

	const hint = INVALID_PLACEHOLDER_HINTS[property];
	issues.push(
		hint
			? `Invalid placeholder ${raw}: ${hint.replaceAll('<id>', placeholderId)}.`
			: `Invalid placeholder ${raw}. Only {{ filters.${placeholderId}.sql }} is supported.`,
	);
	return issues;
}

function countMatches(sql: string, regex: RegExp): number {
	return [...sql.matchAll(new RegExp(regex.source, 'g'))].length;
}

function uniqueIssues(issues: string[]): string[] {
	return [...new Set(issues)];
}

export function renderSqlTemplate(sql: string, selections: StoryFilterSelections, types: StoryFilterTypeById): string {
	const templateIssues = validateSqlFilterTemplate(sql, { knownFilterIds: Object.keys(types) });
	if (templateIssues.length > 0) {
		throw new Error(templateIssues.join(' '));
	}

	const rendered = sql.replace(FILTER_BLOCK_REGEX, (_full, filterId: string, inner: string) => {
		const filterType = types[filterId];
		if (!filterType) {
			throw new Error(`Unknown story filter "${filterId}" referenced in SQL template.`);
		}

		const selection = selections[filterId];
		const sqlValue = renderFilterSqlValue(filterType, selection);
		if (sqlValue === null) {
			return '';
		}

		return inner.replace(FILTER_PLACEHOLDER_REGEX, (_placeholder, placeholderId: string) => {
			if (placeholderId !== filterId) {
				throw new Error(
					`Filter block "${filterId}" contains placeholder for unrelated filter "${placeholderId}".`,
				);
			}
			return sqlValue;
		});
	});

	const leftover = rendered.match(/\{\{\s*filters\.([A-Za-z_][A-Za-z0-9_]*)\.sql\s*\}\}/);
	if (leftover) {
		throw new Error(
			`SQL template placeholder {{ filters.${leftover[1]}.sql }} must appear inside a {% filter %} block.`,
		);
	}

	return rendered;
}

export function renderFilterSqlValue(
	type: StoryFilterType,
	selection: StoryFilterSelection | undefined,
): string | null {
	if (!isFilterSelectionActive(type, selection)) {
		return null;
	}

	switch (type) {
		case 'select':
			return quoteSqlString(selection as string);
		case 'multi_select':
			return (selection as string[])
				.filter((value) => value.trim() !== '')
				.map(quoteSqlString)
				.join(', ');
		case 'search':
			return quoteSqlString(`%${escapeLikePattern(selection as string)}%`);
		case 'date_range': {
			const [from, to] = selection as string[];
			return `${quoteSqlString(from)} AND ${quoteSqlString(to)}`;
		}
	}
}

export function isFilterSelectionActive(type: StoryFilterType, selection: StoryFilterSelection | undefined): boolean {
	if (selection === undefined) {
		return false;
	}

	switch (type) {
		case 'select':
		case 'search':
			return typeof selection === 'string' && selection.trim() !== '';
		case 'multi_select':
			return Array.isArray(selection) && selection.some((value) => value.trim() !== '');
		case 'date_range':
			return (
				Array.isArray(selection) &&
				selection.length >= 2 &&
				Boolean(selection[0]?.trim()) &&
				Boolean(selection[1]?.trim())
			);
	}
}

function quoteSqlString(value: string): string {
	if (value.includes('\0')) {
		throw new Error('Filter values cannot contain null bytes.');
	}
	return `'${value.replace(/'/g, "''")}'`;
}

function escapeLikePattern(value: string): string {
	return value.replace(/([%_\\])/g, '\\$1');
}

function validateFilterDelimiterOrder(sql: string): string[] {
	const issues: string[] = [];
	const openers: Array<{ id: string }> = [];

	for (const delimiter of getFilterDelimiters(sql)) {
		if (delimiter.kind === 'open') {
			if (!STORY_FILTER_ID_REGEX.test(delimiter.id)) {
				issues.push(
					`Invalid filter id "${delimiter.id}" in SQL template. Use letters, numbers, and underscores, starting with a letter or underscore.`,
				);
			}
			if (openers.length > 0) {
				issues.push('Nested story filter blocks are not supported.');
			}
			openers.push(delimiter);
			continue;
		}

		if (!openers.pop()) {
			issues.push('Unexpected "{% endfilter %}" without a preceding "{% filter <id> %}" opener.');
		}
	}

	return issues;
}

function getFilterDelimiters(
	sql: string,
): Array<{ kind: 'open'; id: string; start: number; end: number } | { kind: 'close'; start: number; end: number }> {
	const delimiters: Array<
		{ kind: 'open'; id: string; start: number; end: number } | { kind: 'close'; start: number; end: number }
	> = [];
	const regex = new RegExp(FILTER_DELIMITER_REGEX.source, 'g');
	let match: RegExpExecArray | null;

	while ((match = regex.exec(sql)) !== null) {
		delimiters.push(
			match[2] !== 'endfilter'
				? { kind: 'open', id: match[1].trim(), start: match.index, end: regex.lastIndex }
				: { kind: 'close', start: match.index, end: regex.lastIndex },
		);
	}

	return delimiters;
}

function removeRanges(sql: string, ranges: Array<{ start: number; end: number }>): string {
	const sortedRanges = ranges.sort((a, b) => a.start - b.start);
	let result = '';
	let cursor = 0;

	for (const range of sortedRanges) {
		if (range.end <= cursor) {
			continue;
		}
		if (range.start > cursor) {
			result += sql.slice(cursor, range.start);
		}
		cursor = range.end;
	}

	return result + sql.slice(cursor);
}
