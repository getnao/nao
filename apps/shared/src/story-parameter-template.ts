import type { SemanticQuery } from './tools/execute-semantic-query';

export interface ResolvedStoryParameter {
	value: string;
	label: string;
}

export type ResolvedStoryParameters = Record<string, ResolvedStoryParameter>;

const PARAMETER_PLACEHOLDER_SOURCE = String.raw`\{\{\s*params\.([A-Za-z_][A-Za-z0-9_]*)(\.label)?\s*\}\}`;

/** Replaces `{{ params.<id> }}` with the selected value and `{{ params.<id>.label }}` with its label. */
export function substituteStoryParameters(text: string, parameters: ResolvedStoryParameters): string {
	if (!text.includes('params.')) {
		return text;
	}
	return text.replace(new RegExp(PARAMETER_PLACEHOLDER_SOURCE, 'g'), (placeholder, id: string, label?: string) => {
		const parameter = parameters[id];
		if (!parameter) {
			return placeholder;
		}
		return label ? parameter.label : parameter.value;
	});
}

export function extractParameterIds(text: string): string[] {
	return [...new Set([...text.matchAll(new RegExp(PARAMETER_PLACEHOLDER_SOURCE, 'g'))].map((match) => match[1]))];
}

export function extractSemanticQueryParameterIds(query: SemanticQuery): string[] {
	return extractParameterIds(semanticQueryTemplateFields(query).join('\n'));
}

/**
 * Substitutes `{{ params.<id> }}` placeholders in a semantic query with `query.params` (the defaults the
 * agent ran it with) overridden by `values`, and drops `params` so the semantic layer receives a plain query.
 */
export function resolveSemanticQueryParameters(
	query: SemanticQuery,
	values: Record<string, string> = {},
): Omit<SemanticQuery, 'params'> {
	const { params, ...rest } = query;
	const resolvedValues = { ...params, ...values };
	const missing = extractSemanticQueryParameterIds(query).filter((id) => resolvedValues[id] === undefined);
	if (missing.length > 0) {
		throw new Error(
			`Semantic query uses {{ params.${missing[0]} }} without a value. Pass a default in "params", e.g. "params": { "${missing[0]}": "..." }.`,
		);
	}

	const parameters = Object.fromEntries(
		Object.entries(resolvedValues).map(([id, value]) => [id, { value, label: value }]),
	);
	const substitute = (value: string) => substituteStoryParameters(value, parameters);
	return {
		...rest,
		metrics: rest.metrics.map(substitute),
		...(rest.group_by && { group_by: rest.group_by.map(substitute) }),
		...(rest.order_by && { order_by: rest.order_by.map(substitute) }),
		...(rest.where && { where: rest.where.map(substitute) }),
	};
}

function semanticQueryTemplateFields(query: SemanticQuery): string[] {
	return [...query.metrics, ...(query.group_by ?? []), ...(query.order_by ?? []), ...(query.where ?? [])];
}
