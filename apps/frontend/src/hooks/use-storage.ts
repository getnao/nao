import { useQuery } from '@tanstack/react-query';

import { trpc } from '@/main';

export function useStorageConfig({ enabled = true }: { enabled?: boolean } = {}) {
	return useQuery({ ...trpc.storage.getConfig.queryOptions(), enabled });
}

export function useStorageHealth({ enabled = true }: { enabled?: boolean } = {}) {
	return useQuery({ ...trpc.storage.getHealth.queryOptions(), enabled });
}

export function useStorageUploadLimits() {
	return useQuery(trpc.storage.getUploadLimits.queryOptions());
}

export function useStorageUsage({ enabled = true }: { enabled?: boolean } = {}) {
	return useQuery({ ...trpc.storage.getUsage.queryOptions(), enabled });
}
