import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { trpc } from '@/main';

export const HOME_RECOMMENDATION_LIMIT = 6;
const STALE_TIME_MS = 5 * 60 * 1_000;

export function useHomeRecommendations(enabled: boolean) {
	const timezone = useMemo(resolveTimezone, []);

	return useQuery({
		...trpc.homeRecommendation.list.queryOptions({ timezone, limit: HOME_RECOMMENDATION_LIMIT }),
		enabled,
		staleTime: STALE_TIME_MS,
	});
}

function resolveTimezone(): string {
	try {
		return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
	} catch {
		return 'UTC';
	}
}
