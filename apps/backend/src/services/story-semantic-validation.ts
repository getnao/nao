import {
	extractParameterIds,
	extractSemanticQueryParameterIds,
	resolveSemanticQueryParameters,
} from '@nao/shared/story-parameter-template';
import {
	getStoryFiltersFromCode,
	getStoryParametersFromCode,
	type ParsedFilterBlock,
	type ParsedParameterBlock,
} from '@nao/shared/story-segments';
import type { executeSemanticQuery } from '@nao/shared/tools';

import type { SemanticQuery } from './semantic-layer.service';
import { canFilterMetrics, type CatalogLoader } from './semantic-story-bindings';

type SemanticQueries = Record<string, SemanticQuery>;

/**
 * Checks how a story's parameters and dimension-bound filters line up with its semantic-layer queries.
 * The catalog checks only run when a loader is given (inside an agent run, where the layer is reachable).
 */
export async function getSemanticStoryWarnings(
	code: string,
	semanticQueries: SemanticQueries,
	loadCatalog?: CatalogLoader,
): Promise<string[]> {
	const parameters = getStoryParametersFromCode(code);
	const dimensionFilters = getStoryFiltersFromCode(code).filter((filter) => filter.dimension);
	const warnings = [
		...getParameterUsageWarnings(code, parameters, semanticQueries),
		...getDimensionFilterUsageWarnings(dimensionFilters, semanticQueries),
	];

	const catalog = loadCatalog && (parameters.length > 0 || dimensionFilters.length > 0) ? await loadCatalog() : null;
	if (catalog) {
		warnings.push(...getCatalogWarnings(catalog, parameters, dimensionFilters, semanticQueries));
	}
	return warnings;
}

function getParameterUsageWarnings(
	code: string,
	parameters: ParsedParameterBlock[],
	semanticQueries: SemanticQueries,
): string[] {
	const warnings: string[] = [];
	const declaredIds = new Set(parameters.map((parameter) => parameter.id));
	const queryParameterIds = new Set<string>();

	for (const [queryId, query] of Object.entries(semanticQueries)) {
		for (const parameterId of extractSemanticQueryParameterIds(query)) {
			queryParameterIds.add(parameterId);
			if (!declaredIds.has(parameterId)) {
				warnings.push(
					`[${queryId}] uses {{ params.${parameterId} }} but the story declares no <parameter id="${parameterId}" ... />, so readers cannot switch it and it always runs with its default.`,
				);
			}
		}
	}

	for (const parameter of parameters) {
		if (!queryParameterIds.has(parameter.id)) {
			warnings.push(
				`Story parameter "${parameter.id}" is not used by any semantic-layer query. Put {{ params.${parameter.id} }} in the query's metrics, group_by or where (with a default in "params"), or remove the <parameter> tag.`,
			);
		}
	}

	const codeWithoutParameterTags = parameters.reduce(
		(text, parameter) => text.replace(parameter.rawTag ?? '', ''),
		code,
	);
	for (const parameterId of extractParameterIds(codeWithoutParameterTags)) {
		if (!declaredIds.has(parameterId)) {
			warnings.push(
				`Story text uses {{ params.${parameterId} }} but no <parameter id="${parameterId}" ... /> is declared, so it renders literally.`,
			);
		}
	}

	return warnings;
}

function getDimensionFilterUsageWarnings(
	dimensionFilters: ParsedFilterBlock[],
	semanticQueries: SemanticQueries,
): string[] {
	if (dimensionFilters.length === 0 || Object.keys(semanticQueries).length > 0) {
		return [];
	}
	return dimensionFilters.map(
		(filter) =>
			`Story filter "${filter.id}" is bound to dimension "${filter.dimension}" but no chart uses a semantic-layer query, so it changes nothing. Build the charts with execute_semantic_query, or filter SQL charts with {% filter ${filter.id} %} blocks.`,
	);
}

function getCatalogWarnings(
	catalog: executeSemanticQuery.Catalog,
	parameters: ParsedParameterBlock[],
	dimensionFilters: ParsedFilterBlock[],
	semanticQueries: SemanticQueries,
): string[] {
	const warnings: string[] = [];
	const metricNames = new Set(catalog.metrics.map((metric) => metric.name));

	for (const parameter of parameters.filter((candidate) => candidate.parameterType === 'metric')) {
		for (const option of parameter.options.filter((candidate) => !metricNames.has(candidate.value))) {
			warnings.push(
				`Parameter "${parameter.id}" offers "${option.value}", which is not a metric of the semantic layer.`,
			);
		}
	}

	for (const filter of dimensionFilters) {
		for (const [queryId, metrics] of Object.entries(listMetricsByQuery(semanticQueries, parameters))) {
			const unsupported = metrics.filter((metric) => !canFilterMetrics(catalog, [metric], filter.dimension!));
			if (unsupported.length > 0) {
				warnings.push(
					`[${queryId}] filter "${filter.id}" (${filter.dimension}) will not apply when the metric is ${unsupported.join(', ')}: the semantic layer cannot filter it by that dimension. The chart will say so.`,
				);
			}
		}
	}

	return warnings;
}

/** Every metric a query can run with: its defaults plus each option of the metric parameters it uses. */
function listMetricsByQuery(
	semanticQueries: SemanticQueries,
	parameters: ParsedParameterBlock[],
): Record<string, string[]> {
	return Object.fromEntries(
		Object.entries(semanticQueries).map(([queryId, query]) => {
			const variants = [{}, ...parameterVariants(query, parameters)];
			const metrics = variants.flatMap((values) => {
				try {
					return resolveSemanticQueryParameters(query, values).metrics;
				} catch {
					return [];
				}
			});
			return [queryId, [...new Set(metrics)]];
		}),
	);
}

function parameterVariants(query: SemanticQuery, parameters: ParsedParameterBlock[]): Record<string, string>[] {
	const usedIds = new Set(extractSemanticQueryParameterIds(query));
	return parameters
		.filter((parameter) => usedIds.has(parameter.id))
		.flatMap((parameter) => parameter.options.map((option) => ({ [parameter.id]: option.value })));
}
