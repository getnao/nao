import { useCallback } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ToolCallDensity, UserPreferences } from '@nao/shared/types';
import { useSession } from '@/lib/auth-client';
import { trpc } from '@/main';

const PREFERENCES_STALE_TIME_MS = 5 * 60 * 1000;

export const useToolCallDensity = () => {
	const { data: session } = useSession();
	const queryClient = useQueryClient();

	const preferencesQuery = useQuery({
		...trpc.user.getPreferences.queryOptions(),
		enabled: !!session?.user,
		staleTime: PREFERENCES_STALE_TIME_MS,
	});
	const { mutate: updatePreferences } = useMutation(trpc.user.updatePreferences.mutationOptions());

	const density: ToolCallDensity = preferencesQuery.data?.toolCallDensity ?? 'detailed';

	const setDensity = useCallback(
		(toolCallDensity: ToolCallDensity) => {
			queryClient.setQueryData(
				trpc.user.getPreferences.queryKey(),
				(prev: UserPreferences | undefined): UserPreferences => ({ ...prev, toolCallDensity }),
			);
			updatePreferences({ toolCallDensity });
		},
		[queryClient, updatePreferences],
	);

	return [density, setDensity] as const;
};
