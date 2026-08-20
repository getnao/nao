import { useQuery } from '@tanstack/react-query';

import { useDevOverrides } from '@/lib/dev-overrides';
import { trpc } from '@/main';

export function useIsCloud(): boolean {
	const config = useQuery(trpc.system.getPublicConfig.queryOptions());
	const { cloud } = useDevOverrides();

	if (cloud !== 'default') {
		return cloud === 'on';
	}

	return config.data?.naoMode === 'cloud';
}
