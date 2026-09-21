import { useNavigate } from '@tanstack/react-router';

import type { UsageRouteSearch } from '@/components/settings/usage-route-search';

/** The page a replay was opened from, so the breadcrumb can name it and lead back to it. */
export function useReplayOrigin(usageSearch: UsageRouteSearch) {
	const navigate = useNavigate();
	const isFromRecommendations = usageSearch.origin === 'recommendations';

	const goBack = () => {
		if (isFromRecommendations) {
			navigate({
				to: '/settings/recommendations',
				search: { tab: usageSearch.recoTab, openChats: usageSearch.recoId },
				replace: true,
			});
			return;
		}
		navigate({
			to: '/settings/usage',
			search: usageSearch,
			replace: true,
		});
	};

	return { label: isFromRecommendations ? 'Recommendations' : 'Usage', goBack };
}
