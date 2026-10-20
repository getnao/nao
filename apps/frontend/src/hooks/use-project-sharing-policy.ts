import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';

import type { ProjectSharingPolicy } from '@/lib/project-sharing-policy';
import { useSession } from '@/lib/auth-client';
import { resolveProjectSharingPolicy, UNRESTRICTED_PROJECT_SHARING_POLICY } from '@/lib/project-sharing-policy';
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
		const defaultGroupIds = new Set(
			overview.data.groups.filter((group) => group.isDefault).map((group) => group.id),
		);
		const memberships = overview.data.memberships.filter((membership) => !defaultGroupIds.has(membership.groupId));
		return resolveProjectSharingPolicy(settings, memberships, userId);
	}, [overview.data, settings, userId]);
}
