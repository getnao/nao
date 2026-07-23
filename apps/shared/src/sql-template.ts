export const STORY_FILTER_TYPES = ['select', 'multi_select', 'search', 'date_range'] as const;

export type StoryFilterType = (typeof STORY_FILTER_TYPES)[number];

export type StoryFilterSelection = string | string[];

export type StoryFilterSelections = Record<string, StoryFilterSelection>;

export type StoryFilterTypeById = Record<string, StoryFilterType>;

const FILTER_BLOCK_REGEX = /\{%\s*filter\s+([A-Za-z_][A-Za-z0-9_]*)\s*%\}([\s\S]*?)\{%\s*endfilter\s*%\}/g;
const FILTER_PLACEHOLDER_REGEX = /\{\{\s*filters\.([A-Za-z_][A-Za-z0-9_]*)\.sql\s*\}\}/g;

export function stripSqlFilterBlocks(sql: string): string {
	return sql
		.replace(FILTER_BLOCK_REGEX, '')
		.replace(/[ \t]+\n/g, '\n')
		.replace(/\n{2,}/g, '\n');
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

export function renderSqlTemplate(sql: string, selections: StoryFilterSelections, types: StoryFilterTypeById): string {
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

	return rendered.replace(/[ \t]+\n/g, '\n').replace(/\n{2,}/g, '\n');
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
			return (selection as string[]).filter(Boolean).map(quoteSqlString).join(', ');
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
