import { useQuery } from '@tanstack/react-query';

import { trpc } from '@/main';

export function useCanSeeAdvancedSettings(): boolean {
	const project = useQuery(trpc.project.getCurrent.queryOptions());
	const effectiveAccess = useQuery({
		...trpc.userGroup.effectiveAccess.queryOptions(),
		enabled: Boolean(project.data),
	});
	if (project.isSuccess && !project.data) {
		return true;
	}
	return effectiveAccess.data?.canSeeAdvancedSettings === true;
}
