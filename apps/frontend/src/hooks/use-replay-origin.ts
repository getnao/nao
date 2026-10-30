import { useNavigate } from '@tanstack/react-router';

import type { UsageRouteSearch } from '@/components/settings/usage-route-search';

const ORIGIN_LABELS = {
	recommendations: 'Recommendations',
	tests: 'Tests',
} as const;

/** The page a replay was opened from, so the breadcrumb can name it and lead back to it. */
export function useReplayOrigin(usageSearch: UsageRouteSearch) {
	const navigate = useNavigate();

	const goBack = () => {
		if (usageSearch.origin === 'recommendations') {
			navigate({
				to: '/settings/recommendations',
				search: { tab: usageSearch.recoTab, openChats: usageSearch.recoId },
				replace: true,
			});
			return;
		}
		if (usageSearch.origin === 'tests') {
			navigate({ to: '/settings/tests', search: { run: usageSearch.testRunId }, replace: true });
			return;
		}
		navigate({
			to: '/settings/usage',
			search: usageSearch,
			replace: true,
		});
	};

	return { label: usageSearch.origin ? ORIGIN_LABELS[usageSearch.origin] : 'Usage & Costs', goBack };
}
