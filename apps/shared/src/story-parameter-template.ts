import type { SemanticQuery } from './tools/execute-semantic-query';

export interface ResolvedStoryParameter {
	value: string;
	label: string;
}

export type ResolvedStoryParameters = Record<string, ResolvedStoryParameter>;

const PARAMETER_PLACEHOLDER_SOURCE = String.raw`\{\{\s*params\.([A-Za-z_][A-Za-z0-9_]*)(\.label)?\s*\}\}`;

const TAG_ATTRIBUTE_REGEX = /(\w+=)("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')/g;
const JSON_VALUE_REGEX = /^\s*(\[|\{(?!\{))/;

/** Replaces `{{ params.<id> }}` with the selected value and `{{ params.<id>.label }}` with its label. */
export function substituteStoryParameters(text: string, parameters: ResolvedStoryParameters): string {
	return replacePlaceholders(text, parameters, (value) => value);
}

/**
 * Same as `substituteStoryParameters` for the attributes of a story tag: each inserted value is escaped
 * for its attribute's quotes, and as a JSON string inside JSON attributes such as `series`.
 */
export function substituteStoryParametersInAttributes(attrString: string, parameters: ResolvedStoryParameters): string {
	if (!attrString.includes('params.')) {
		return attrString;
	}
	return attrString.replace(TAG_ATTRIBUTE_REGEX, (_attribute, name: string, quotedValue: string) => {
		const quote = quotedValue[0];
		const value = quotedValue.slice(1, -1);
		const isJson = JSON_VALUE_REGEX.test(value);
		const escape = (inserted: string) => escapeAttributeText(isJson ? escapeJsonText(inserted) : inserted, quote);
		return `${name}${quote}${replacePlaceholders(value, parameters, escape)}${quote}`;
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
	const missing = extractSemanticQueryParameterIds(query).filter((id) => !Object.hasOwn(resolvedValues, id));
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

function replacePlaceholders(
	text: string,
	parameters: ResolvedStoryParameters,
	escape: (value: string) => string,
): string {
	if (!text.includes('params.')) {
		return text;
	}
	return text.replace(new RegExp(PARAMETER_PLACEHOLDER_SOURCE, 'g'), (placeholder, id: string, label?: string) => {
		if (!Object.hasOwn(parameters, id)) {
			return placeholder;
		}
		const parameter = parameters[id];
		return escape(label ? parameter.label : parameter.value);
	});
}

function escapeJsonText(value: string): string {
	return JSON.stringify(value).slice(1, -1);
}

function escapeAttributeText(value: string, quote: string): string {
	return value.replace(/\\/g, '\\\\').replaceAll(quote, `\\${quote}`);
}

function semanticQueryTemplateFields(query: SemanticQuery): string[] {
	return [...query.metrics, ...(query.group_by ?? []), ...(query.order_by ?? []), ...(query.where ?? [])];
}
