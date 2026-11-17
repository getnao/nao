import { useQuery } from '@tanstack/react-query';

import { trpc } from '@/main';

export type ProjectSwitcherMode = 'switch' | 'static';

export function useMultiProject(): ProjectSwitcherMode {
	const config = useQuery(trpc.system.getPublicConfig.queryOptions());

	const canSwitchProjects = config.data?.naoMode === 'cloud' || config.data?.selfHostedMultiProjectEnabled === true;

	return canSwitchProjects ? 'switch' : 'static';
}
