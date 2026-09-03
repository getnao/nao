import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from '@tanstack/react-router';
import { useCallback } from 'react';

import { setActiveProjectId } from '@/lib/active-project';

export function useProjectSwitch(currentProjectId?: string) {
	const queryClient = useQueryClient();
	const router = useRouter();

	return useCallback(
		async (projectId: string) => {
			if (!currentProjectId || projectId === currentProjectId) {
				return false;
			}

			setActiveProjectId(projectId);
			await queryClient.invalidateQueries();
			await router.invalidate();
			return true;
		},
		[currentProjectId, queryClient, router],
	);
}
