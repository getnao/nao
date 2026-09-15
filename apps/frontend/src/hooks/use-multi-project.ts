import { useQuery } from '@tanstack/react-query';

import { trpc } from '@/main';

export type ProjectSwitcherMode = 'switch' | 'static';

export function useMultiProject(): ProjectSwitcherMode {
	const config = useQuery(trpc.system.getPublicConfig.queryOptions());

	return config.data?.naoMode === 'cloud' ? 'switch' : 'static';
}
