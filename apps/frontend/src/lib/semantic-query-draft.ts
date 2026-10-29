import type { executeSemanticQuery } from '@nao/shared/tools';

type SemanticQuery = executeSemanticQuery.SemanticQuery;

/** A semantic query as its edit form holds it: every field is editable text. */
export interface SemanticQueryDraft {
	metrics: string[];
	group_by: string[];
	where: string[];
	order_by: string[];
	limit: string;
	start_time: string;
	end_time: string;
}

export function toSemanticQueryDraft(query: SemanticQuery): SemanticQueryDraft {
	return {
		metrics: query.metrics,
		group_by: query.group_by ?? [],
		where: query.where ?? [],
		order_by: query.order_by ?? [],
		limit: query.limit === undefined ? '' : String(query.limit),
		start_time: query.start_time ?? '',
		end_time: query.end_time ?? '',
	};
}

/** Null while the draft is not a query the semantic layer can compile: no metric or an invalid limit. */
export function fromSemanticQueryDraft(draft: SemanticQueryDraft): SemanticQuery | null {
	const metrics = nonEmptyValues(draft.metrics);
	if (metrics.length === 0 || hasInvalidLimit(draft)) {
		return null;
	}
	const groupBy = nonEmptyValues(draft.group_by);
	const where = nonEmptyValues(draft.where);
	const orderBy = nonEmptyValues(draft.order_by);
	const limit = parseLimit(draft.limit);
	const startTime = draft.start_time.trim();
	const endTime = draft.end_time.trim();
	return {
		metrics,
		...(groupBy.length > 0 && { group_by: groupBy }),
		...(where.length > 0 && { where }),
		...(orderBy.length > 0 && { order_by: orderBy }),
		...(limit !== undefined && { limit }),
		...(startTime && { start_time: startTime }),
		...(endTime && { end_time: endTime }),
	};
}

/** The query as the form would save it, so an untouched form never reads as changed. */
export function normalizeSemanticQuery(query: SemanticQuery): SemanticQuery {
	return fromSemanticQueryDraft(toSemanticQueryDraft(query)) ?? query;
}

export function hasInvalidLimit(draft: SemanticQueryDraft): boolean {
	return draft.limit.trim() !== '' && parseLimit(draft.limit) === undefined;
}

export function nonEmptyValues(values: string[]): string[] {
	return values.map((value) => value.trim()).filter((value) => value.length > 0);
}

function parseLimit(value: string): number | undefined {
	const limit = Number(value.trim());
	return Number.isInteger(limit) && limit > 0 ? limit : undefined;
}
