import { useQuery } from '@tanstack/react-query';

import { trpc } from '@/main';

/** Admins, and context admins whose groups grant it, can switch the Context Hub to the file tree. */
export function useCanUseAdvancedContextExplorer(): boolean {
	const project = useQuery(trpc.project.getCurrent.queryOptions());
	const effectiveAccess = useQuery({
		...trpc.userGroup.effectiveAccess.queryOptions(),
		enabled: Boolean(project.data),
	});
	return effectiveAccess.data?.canUseAdvancedContextExplorer === true;
}
