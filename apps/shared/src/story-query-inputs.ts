import {
	extractSqlFilterIds,
	type StoryFilterSelection,
	type StoryFilterSelections,
	type StoryFilterSpec,
	type StoryFilterSpecById,
} from './sql-template';

/**
 * A filter value a custom story sends with a query. Its shape picks how `{{ filters.<id>.sql }}` renders:
 * a string is an exact match, a number a numeric literal, a list an `IN` list, `{ from, to }` a date range
 * and `{ contains }` a `LIKE` pattern. `null`, `''` and `[]` leave the filter block out.
 */
export type StoryQueryFilterValue =
	| string
	| number
	| string[]
	| { from: string; to: string }
	| { contains: string }
	| null;

export type StoryQueryFilters = Record<string, StoryQueryFilterValue>;

export type StoryQueryParams = Record<string, string>;

export interface StoryQueryInputs {
	filters?: StoryQueryFilters;
	params?: StoryQueryParams;
}

/** Parameter values land in semantic queries as-is, so they are kept to plain tokens: names, numbers, dates. */
export const STORY_QUERY_PARAM_VALUE_REGEX = /^[\w.:-]+$/;

export interface StoryQueryFilterBindings {
	selections: StoryFilterSelections;
	specs: StoryFilterSpecById;
}

export function hasStoryQueryInputs(inputs: StoryQueryInputs | undefined): inputs is StoryQueryInputs {
	return Object.keys(inputs?.filters ?? {}).length > 0 || Object.keys(inputs?.params ?? {}).length > 0;
}

export function toStoryFilterBindings(filters: StoryQueryFilters = {}): StoryQueryFilterBindings {
	const selections: StoryFilterSelections = {};
	const specs: StoryFilterSpecById = {};
	for (const [filterId, value] of Object.entries(filters)) {
		const binding = toFilterBinding(value);
		if (binding) {
			selections[filterId] = binding.selection;
			specs[filterId] = binding.spec;
		}
	}
	return { selections, specs };
}

/** Filter blocks the story sent no value for are declared inactive, so the template leaves them out. */
export function withInactiveFilterSpecs(sql: string, specs: StoryFilterSpecById): StoryFilterSpecById {
	const inactive = Object.fromEntries(extractSqlFilterIds(sql).map((filterId) => [filterId, INACTIVE_SPEC]));
	return { ...inactive, ...specs };
}

/** Keeps the request key stable across renders whatever order the story wrote its filters in. */
export function serializeStoryQueryInputs(inputs: StoryQueryInputs | undefined): string {
	if (!hasStoryQueryInputs(inputs)) {
		return '';
	}
	return JSON.stringify({ filters: sortKeys(inputs.filters), params: sortKeys(inputs.params) });
}

const INACTIVE_SPEC: StoryFilterSpec = { type: 'select' };

function toFilterBinding(
	value: StoryQueryFilterValue,
): { selection: StoryFilterSelection; spec: StoryFilterSpec } | null {
	if (value === null) {
		return null;
	}
	if (typeof value === 'string') {
		return { selection: value, spec: { type: 'select' } };
	}
	if (typeof value === 'number') {
		return Number.isFinite(value)
			? { selection: String(value), spec: { type: 'text', valueType: 'number' } }
			: null;
	}
	if (Array.isArray(value)) {
		return { selection: value, spec: { type: 'multi_select' } };
	}
	if ('contains' in value) {
		return { selection: value.contains, spec: { type: 'search' } };
	}
	return { selection: [value.from, value.to], spec: { type: 'date_range' } };
}

function sortKeys<T>(record: Record<string, T> | undefined): Record<string, T> | undefined {
	return record && Object.fromEntries(Object.entries(record).sort(([a], [b]) => a.localeCompare(b)));
}
