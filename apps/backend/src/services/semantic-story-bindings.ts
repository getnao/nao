import {
	isFilterSelectionActive,
	renderFilterSqlValue,
	type StoryFilterSelection,
	type StoryFilterSelections,
} from '@nao/shared/sql-template';
import { resolveSemanticQueryParameters } from '@nao/shared/story-parameter-template';
import {
	getStoryFiltersFromCode,
	getStoryParametersFromCode,
	type ParsedFilterBlock,
	resolveStoryParameters,
} from '@nao/shared/story-segments';
import type { executeSemanticQuery } from '@nao/shared/tools';

import type { SemanticQuery } from './semantic-layer.service';

const DIMENSION_NAME_REGEX = /^[A-Za-z_][A-Za-z0-9_]*$/;
const METRIC_TIME_DIMENSION = 'metric_time';

/** What a story's reader selected, applied to every semantic-layer query of the story. */
export interface SemanticStoryBindings {
	parameterValues: Record<string, string>;
	dimensionFilters: ParsedFilterBlock[];
	selections: StoryFilterSelections;
}

export interface BoundSemanticQuery {
	query: SemanticQuery;
	/** Active filters left out because a metric of the query cannot be filtered by their dimension. */
	skippedFilterIds: string[];
}

export type CatalogLoader = () => Promise<executeSemanticQuery.Catalog | null>;

export function semanticBindingsFromCode(code: string, selections: StoryFilterSelections = {}): SemanticStoryBindings {
	const parameters = resolveStoryParameters(getStoryParametersFromCode(code), selections);
	return {
		parameterValues: Object.fromEntries(Object.entries(parameters).map(([id, parameter]) => [id, parameter.value])),
		dimensionFilters: getStoryFiltersFromCode(code).filter((filter) => filter.dimension),
		selections,
	};
}

/**
 * Applies the story's parameter values and the active dimension filters to a stored semantic query.
 * Filters become `where` constraints (or the metric_time bounds), but only on queries whose metrics
 * the semantic layer catalog says can be filtered by that dimension.
 */
export async function bindSemanticQuery(
	query: SemanticQuery,
	bindings: SemanticStoryBindings | undefined,
	loadCatalog: CatalogLoader,
): Promise<BoundSemanticQuery> {
	if (!bindings) {
		return { query, skippedFilterIds: [] };
	}

	const parameterized: SemanticQuery = { ...query, params: { ...query.params, ...bindings.parameterValues } };
	const activeFilters = bindings.dimensionFilters.filter((filter) =>
		isFilterSelectionActive(filter.filterType, bindings.selections[filter.id], filter.valueType),
	);
	if (activeFilters.length === 0) {
		return { query: parameterized, skippedFilterIds: [] };
	}

	const metrics = resolveSemanticQueryParameters(parameterized).metrics;
	const catalog = await loadCatalog();
	const applicable = activeFilters.filter(
		(filter) =>
			canFilterMetrics(catalog, metrics, filter.dimension!) &&
			(filter.filterType !== 'date_range' || isTimeDimension(catalog, filter.dimension!)),
	);

	return {
		query: applicable.reduce<SemanticQuery>(
			(bound, filter) => applyDimensionFilter(bound, filter, bindings.selections[filter.id]!),
			parameterized,
		),
		skippedFilterIds: activeFilters.filter((filter) => !applicable.includes(filter)).map((filter) => filter.id),
	};
}

/** Unknown metrics and an unavailable catalog are let through: the semantic layer reports real errors at compile time. */
export function canFilterMetrics(
	catalog: executeSemanticQuery.Catalog | null,
	metrics: string[],
	dimension: string,
): boolean {
	if (!DIMENSION_NAME_REGEX.test(dimension)) {
		return false;
	}
	if (!catalog || dimension === METRIC_TIME_DIMENSION) {
		return true;
	}
	return metrics.every((metricName) => {
		const metric = catalog.metrics.find((candidate) => candidate.name === metricName);
		return !metric || metric.dimensions.includes(dimension);
	});
}

/** Date ranges compile to TimeDimension predicates, which the semantic layer rejects on categorical dimensions. */
export function isTimeDimension(catalog: executeSemanticQuery.Catalog | null, dimension: string): boolean {
	if (!catalog || dimension === METRIC_TIME_DIMENSION) {
		return true;
	}
	const catalogDimension = catalog.dimensions.find((candidate) => candidate.name === dimension);
	return !catalogDimension || catalogDimension.type === 'time';
}

export function dimensionExpression(dimension: string): string {
	return `{{ Dimension('${dimension}') }}`;
}

function applyDimensionFilter(
	query: SemanticQuery,
	filter: ParsedFilterBlock,
	selection: StoryFilterSelection,
): SemanticQuery {
	const dimension = filter.dimension!;

	if (filter.filterType === 'date_range') {
		const [start, end] = selection as string[];
		if (dimension === METRIC_TIME_DIMENSION) {
			return { ...query, start_time: start, end_time: end };
		}
		const range = renderFilterSqlValue('date_range', selection)!;
		return withWhere(query, `{{ TimeDimension('${dimension}', 'day') }} BETWEEN ${range}`);
	}

	const value = renderFilterSqlValue(filter.filterType, selection, filter.valueType)!;
	return withWhere(query, `${dimensionExpression(dimension)} ${comparisonOperator(filter.filterType, value)}`);
}

function comparisonOperator(filterType: ParsedFilterBlock['filterType'], value: string): string {
	switch (filterType) {
		case 'multi_select':
			return `IN (${value})`;
		case 'search':
			return `LIKE ${value}`;
		default:
			return `= ${value}`;
	}
}

function withWhere(query: SemanticQuery, condition: string): SemanticQuery {
	return { ...query, where: [...(query.where ?? []), condition] };
}
