import { useQuery } from '@tanstack/react-query';

import { trpc } from '@/main';

export function useIsCloud(): boolean {
	const config = useQuery(trpc.system.getPublicConfig.queryOptions());
	return config.data?.naoMode === 'cloud';
}
