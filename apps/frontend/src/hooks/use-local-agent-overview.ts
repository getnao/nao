import { useQuery } from '@tanstack/react-query';

import { getLocalAgentOverview, isDesktopApp } from '@/lib/local-agent';

const OVERVIEW_REFRESH_MS = 60 * 1000;

/** The plan limits and this server's usage of the user's Claude, kept fresh while the page is open. */
export function useLocalAgentOverview() {
	return useQuery({
		queryKey: ['local-agent', 'overview'],
		queryFn: getLocalAgentOverview,
		enabled: isDesktopApp(),
		refetchInterval: OVERVIEW_REFRESH_MS,
		retry: false,
	});
}
