import { useQuery } from '@tanstack/react-query';

import { trpc } from '@/main';

export function useCustomStoriesEnabled(): boolean {
	const config = useQuery(trpc.system.getPublicConfig.queryOptions());
	return config.data?.betaCustomStoriesEnabled === true;
}
