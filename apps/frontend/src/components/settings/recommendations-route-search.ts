export const RECOMMENDATION_TABS = ['config', 'recommendations', 'applied', 'dismissed'] as const;
export type RecommendationTab = (typeof RECOMMENDATION_TABS)[number];

export type RecommendationsRouteSearch = {
	tab: RecommendationTab | undefined;
	openChats: string | undefined;
};

export function validateRecommendationsSearch(search: Record<string, unknown>): RecommendationsRouteSearch {
	return {
		tab:
			typeof search.tab === 'string' && RECOMMENDATION_TABS.includes(search.tab as RecommendationTab)
				? (search.tab as RecommendationTab)
				: undefined,
		openChats: typeof search.openChats === 'string' && search.openChats.length > 0 ? search.openChats : undefined,
	};
}
