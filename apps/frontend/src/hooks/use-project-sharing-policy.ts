import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';

import type { ProjectSharingPolicy } from '@/lib/project-sharing-policy';
import { useSession } from '@/lib/auth-client';
import {
	getCustomGroupMemberships,
	resolveProjectSharingPolicy,
	UNRESTRICTED_PROJECT_SHARING_POLICY,
} from '@/lib/project-sharing-policy';
import { trpc } from '@/main';
import { useProjectSharingSettings } from '@/stores/project-sharing-settings';

export function useProjectSharingPolicy(): ProjectSharingPolicy {
	const { data: session } = useSession();
	const settings = useProjectSharingSettings();
	const overview = useQuery({ ...trpc.userGroup.overview.queryOptions(), retry: false });
	const userId = session?.user?.id;

	return useMemo(() => {
		if (!overview.data || !userId) {
			return UNRESTRICTED_PROJECT_SHARING_POLICY;
		}
		return resolveProjectSharingPolicy(settings, getCustomGroupMemberships(overview.data), userId);
	}, [overview.data, settings, userId]);
}
