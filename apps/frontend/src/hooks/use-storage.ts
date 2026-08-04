import { useQuery } from '@tanstack/react-query';

import { trpc } from '@/main';

export function useStorageConfig() {
	return useQuery(trpc.storage.getConfig.queryOptions());
}

export function useStorageHealth() {
	return useQuery(trpc.storage.getHealth.queryOptions());
}
