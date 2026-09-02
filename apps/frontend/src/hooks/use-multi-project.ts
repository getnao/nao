import { useQuery } from '@tanstack/react-query';

import { trpc } from '@/main';

export type ProjectSwitcherMode = 'switch' | 'static' | 'upgrade';

export function useMultiProject(): ProjectSwitcherMode {
	const config = useQuery(trpc.system.getPublicConfig.queryOptions());

	if (config.isPending) {
		return 'static';
	}

	return config.data?.naoMode === 'cloud' ? 'switch' : 'static';
}
