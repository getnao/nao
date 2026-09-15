import { useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { UserGroupFeature } from '@nao/shared';

import type { EffectiveUserGroupAccess } from '@/lib/effective-user-group-features';
import { getActiveProjectId } from '@/lib/active-project';
import { getRenderableUserGroupAccess } from '@/lib/effective-user-group-features';
import { trpc } from '@/main';

export function useEffectiveUserGroupFeatures() {
	const project = useQuery(trpc.project.getCurrent.queryOptions());
	const activeProjectId = getActiveProjectId();
	const hasCurrentProject = Boolean(project.data?.id) && (!activeProjectId || project.data?.id === activeProjectId);
	const query = useQuery({
		...trpc.userGroup.effectiveAccess.queryOptions(),
		enabled: hasCurrentProject,
	});
	const isLoading = project.isPending || (hasCurrentProject && query.isPending);
	const isError = project.isError || query.isError;
	const access = getRenderableUserGroupAccess(
		query.data as EffectiveUserGroupAccess | undefined,
		hasCurrentProject && !isLoading && !isError,
	);
	const { features, toolCallDensityPolicy } = access;
	const isFeatureEnabled = useCallback((feature: UserGroupFeature) => features[feature], [features]);

	return {
		features,
		storyCreationEnabled: features['story-creation'],
		automationCreationEnabled: features['automation-creation'],
		toolCallDensityPolicy,
		isFeatureEnabled,
		isLoading,
		isError,
	};
}
