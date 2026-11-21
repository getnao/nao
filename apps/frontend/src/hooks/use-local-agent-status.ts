import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';

import { getLocalAgentStatus, isDesktopApp } from '@/lib/local-agent';

const STATUS_QUERY_KEY = ['local-agent', 'status'];
const STATUS_STALE_TIME_MS = 5 * 60 * 1000;

/** Whether the desktop app can run turns on the user's own Claude, and with which models. */
export function useLocalAgentStatus() {
	const isAvailable = isDesktopApp();
	const queryClient = useQueryClient();
	const statusQuery = useQuery({
		queryKey: STATUS_QUERY_KEY,
		queryFn: () => getLocalAgentStatus(),
		enabled: isAvailable,
		staleTime: STATUS_STALE_TIME_MS,
		retry: false,
	});

	const refresh = useCallback(
		() => queryClient.fetchQuery({ queryKey: STATUS_QUERY_KEY, queryFn: () => getLocalAgentStatus(true) }),
		[queryClient],
	);

	return {
		isAvailable,
		status: statusQuery.data,
		isPending: isAvailable && statusQuery.isPending,
		refresh,
	};
}
