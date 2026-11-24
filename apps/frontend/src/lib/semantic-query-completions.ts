import { nonEmptyValues } from './semantic-query-draft';
import type { executeSemanticQuery } from '@nao/shared/tools';
import type { CompletionOption, CompletionOptions } from '@/components/ui/completion-input';
import type { SemanticQueryDraft } from './semantic-query-draft';

export type SemanticQueryListField = 'metrics' | 'group_by' | 'where' | 'order_by';

interface CompletionRequest {
	field: SemanticQueryListField;
	value: string;
	cursor: number;
	rowIndex: number;
	draft: SemanticQueryDraft;
	catalog: executeSemanticQuery.Catalog;
}

const METRIC_TIME = 'metric_time';
const TIME_GRANULARITIES = ['day', 'week', 'month', 'quarter', 'year'];
const MAX_COMPLETIONS = 50;
const NAME_CHARACTERS = /[\w]*$/;
const TEMPLATE_ARGUMENT = /\b(Dimension|TimeDimension|Metric)\(\s*['"]([\w]*)$/;

export function getSemanticQueryCompletions(request: CompletionRequest): CompletionOptions {
	switch (request.field) {
		case 'metrics':
			return completeName(request, metricCompletions(request));
		case 'group_by':
			return completeName(request, groupByCompletions(request));
		case 'order_by':
			return completeOrderBy(request);
		case 'where':
			return completeWhere(request);
	}
}

function metricCompletions({ catalog, draft, rowIndex }: CompletionRequest): CompletionOption[] {
	const taken = new Set(otherRows(draft.metrics, rowIndex));
	return catalog.metrics
		.filter((metric) => !taken.has(metric.name))
		.map((metric) => ({
			label: metric.name,
			detail: metric.label && metric.label !== metric.name ? metric.label : (metric.description ?? undefined),
			insertText: metric.name,
		}));
}

function groupByCompletions({ catalog, draft, rowIndex }: CompletionRequest): CompletionOption[] {
	const taken = new Set(otherRows(draft.group_by, rowIndex));
	return availableDimensions(catalog, draft)
		.flatMap((dimension) => groupByNames(dimension).map((name) => ({ name, dimension })))
		.filter(({ name }) => !taken.has(name))
		.map(({ name, dimension }) => ({ label: name, detail: describeDimension(dimension), insertText: name }));
}

function completeOrderBy(request: CompletionRequest): CompletionOptions {
	const { draft, rowIndex, value, cursor } = request;
	const taken = new Set(otherRows(draft.order_by, rowIndex).map((item) => item.replace(/^-/, '')));
	const sortable = [...nonEmptyValues(draft.metrics), ...nonEmptyValues(draft.group_by)].filter(
		(name) => !taken.has(name),
	);
	const isDescending = value.slice(0, cursor).trimStart().startsWith('-');
	const items = sortable.map((name) =>
		isDescending
			? { label: `-${name}`, detail: 'Descending', insertText: name }
			: { label: name, detail: 'Ascending', insertText: name },
	);
	return completeName(request, items);
}

function completeWhere(request: CompletionRequest): CompletionOptions {
	const { value, cursor, catalog, draft } = request;
	const beforeCursor = value.slice(0, cursor);
	const argument = beforeCursor.match(TEMPLATE_ARGUMENT);
	if (argument) {
		return completeName(request, templateArgumentCompletions(argument[1], catalog, draft));
	}
	const fragment = beforeCursor.match(NAME_CHARACTERS)?.[0] ?? '';
	const isTypingName = fragment.length > 0 || value.trim() === '';
	if (!isTypingName || isInsideStringLiteral(beforeCursor)) {
		return emptyResult(cursor);
	}
	return completeName(request, filterTemplateCompletions(catalog, draft));
}

function templateArgumentCompletions(
	template: string,
	catalog: executeSemanticQuery.Catalog,
	draft: SemanticQueryDraft,
): CompletionOption[] {
	if (template === 'Metric') {
		return catalog.metrics.map((metric) => ({ label: metric.name, insertText: metric.name }));
	}
	return availableDimensions(catalog, draft)
		.filter((dimension) => template === 'Dimension' || isTimeDimension(dimension))
		.map((dimension) => ({
			label: dimension.name,
			detail: describeDimension(dimension),
			insertText: dimension.name,
		}));
}

function filterTemplateCompletions(
	catalog: executeSemanticQuery.Catalog,
	draft: SemanticQueryDraft,
): CompletionOption[] {
	return availableDimensions(catalog, draft).map((dimension) => ({
		label: dimension.name,
		detail: describeDimension(dimension),
		insertText: isTimeDimension(dimension)
			? `{{ TimeDimension('${dimension.name}', '${dimension.granularity ?? 'day'}') }}`
			: `{{ Dimension('${dimension.name}') }}`,
	}));
}

/** Replaces the name around the cursor with the matching completions, best matches first. */
function completeName({ value, cursor }: CompletionRequest, candidates: CompletionOption[]): CompletionOptions {
	const fragment = value.slice(0, cursor).match(NAME_CHARACTERS)?.[0] ?? '';
	const after = value.slice(cursor).match(/^[\w]*/)?.[0] ?? '';
	const needle = fragment.toLowerCase();
	const items = candidates
		.flatMap((item) => {
			const rank = matchRank(item, needle);
			return rank === null ? [] : [{ item, rank }];
		})
		.sort((left, right) => left.rank - right.rank)
		.slice(0, MAX_COMPLETIONS)
		.map(({ item }) => item);
	return { from: cursor - fragment.length, to: cursor + after.length, items };
}

function matchRank(item: CompletionOption, needle: string): number | null {
	const name = item.label.replace(/^-/, '').toLowerCase();
	if (needle === '' || name.startsWith(needle)) {
		return 0;
	}
	if (name.includes(needle)) {
		return 1;
	}
	return item.detail?.toLowerCase().includes(needle) ? 2 : null;
}

/** Dimensions every selected metric can be grouped by, or every dimension before a metric is picked. */
function availableDimensions(
	catalog: executeSemanticQuery.Catalog,
	draft: SemanticQueryDraft,
): executeSemanticQuery.CatalogDimension[] {
	const selectedMetrics = new Set(nonEmptyValues(draft.metrics));
	const metrics = catalog.metrics.filter((metric) => selectedMetrics.has(metric.name));
	const names = metrics.length > 0 ? sharedDimensionNames(metrics) : allDimensionNames(catalog);
	const byName = new Map(catalog.dimensions.map((dimension) => [dimension.name, dimension]));
	return [...names].sort(byMetricTimeFirst).map((name) => byName.get(name) ?? implicitDimension(name));
}

function sharedDimensionNames(metrics: executeSemanticQuery.CatalogMetric[]): Set<string> {
	return metrics
		.map((metric) => new Set(metric.dimensions))
		.reduce((shared, dimensions) => new Set([...shared].filter((name) => dimensions.has(name))));
}

function allDimensionNames(catalog: executeSemanticQuery.Catalog): Set<string> {
	return new Set([
		...catalog.metrics.flatMap((metric) => metric.dimensions),
		...catalog.dimensions.map((dimension) => dimension.name),
	]);
}

function implicitDimension(name: string): executeSemanticQuery.CatalogDimension {
	return { name, type: name === METRIC_TIME ? 'time' : 'categorical', granularity: null, description: null };
}

function groupByNames(dimension: executeSemanticQuery.CatalogDimension): string[] {
	if (!isTimeDimension(dimension)) {
		return [dimension.name];
	}
	const finest = Math.max(TIME_GRANULARITIES.indexOf(dimension.granularity ?? 'day'), 0);
	return TIME_GRANULARITIES.slice(finest).map((granularity) => `${dimension.name}__${granularity}`);
}

function describeDimension(dimension: executeSemanticQuery.CatalogDimension): string | undefined {
	if (dimension.name === METRIC_TIME) {
		return "Each metric's own time axis";
	}
	return dimension.description ?? (isTimeDimension(dimension) ? 'Time dimension' : undefined);
}

function isTimeDimension(dimension: executeSemanticQuery.CatalogDimension): boolean {
	return dimension.type === 'time';
}

function byMetricTimeFirst(left: string, right: string): number {
	if (left === METRIC_TIME || right === METRIC_TIME) {
		return left === METRIC_TIME ? -1 : 1;
	}
	return left.localeCompare(right);
}

function isInsideStringLiteral(text: string): boolean {
	return (text.match(/'/g)?.length ?? 0) % 2 === 1;
}

function otherRows(values: string[], rowIndex: number): string[] {
	return nonEmptyValues(values.filter((_, index) => index !== rowIndex));
}

function emptyResult(cursor: number): CompletionOptions {
	return { from: cursor, to: cursor, items: [] };
}
