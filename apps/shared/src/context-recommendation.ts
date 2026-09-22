export const MAX_TRIGGER_CHATS = 500;

export const CONTEXT_RECOMMENDATION_CATEGORIES = [
	'tool_error',
	'hallucination',
	'semantic_missing',
	'context_bloat',
	'skills',
	'other',
] as const;
export type ContextRecommendationCategory = (typeof CONTEXT_RECOMMENDATION_CATEGORIES)[number];

export const CONTEXT_RECOMMENDATION_CATEGORY_LABELS: Record<ContextRecommendationCategory, string> = {
	tool_error: 'Tool errors',
	hallucination: 'Hallucinations',
	semantic_missing: 'Semantic missing',
	context_bloat: 'Context bloat',
	skills: 'Skills',
	other: 'Other',
};

export function normalizeContextRecommendationCategory(
	category: string | null | undefined,
): ContextRecommendationCategory {
	const key = category as ContextRecommendationCategory | null | undefined;
	return key && CONTEXT_RECOMMENDATION_CATEGORIES.includes(key) ? key : 'other';
}
