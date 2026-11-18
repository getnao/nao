import { useCallback } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ToolCallDensity, UserPreferences } from '@nao/shared/types';
import { useEffectiveUserGroupFeatures } from '@/hooks/use-effective-user-group-features';
import { useSession } from '@/lib/auth-client';
import { getEffectiveToolCallDensity } from '@/lib/effective-user-group-features';
import { trpc } from '@/main';

const PREFERENCES_STALE_TIME_MS = 5 * 60 * 1000;

export const useToolCallDensity = () => {
	const { data: session } = useSession();
	const { toolCallDensityPolicy, isLoading: isPolicyLoading } = useEffectiveUserGroupFeatures();
	const queryClient = useQueryClient();
	const preferencesQueryKey = trpc.user.getPreferences.queryKey();

	const preferencesQuery = useQuery({
		...trpc.user.getPreferences.queryOptions(),
		enabled: !!session?.user,
		staleTime: PREFERENCES_STALE_TIME_MS,
	});

	const { mutate: updatePreferences } = useMutation(
		trpc.user.updatePreferences.mutationOptions({
			onMutate: async ({ toolCallDensity }) => {
				if (!toolCallDensity) {
					return;
				}

				await queryClient.cancelQueries({ queryKey: preferencesQueryKey });
				const previous = queryClient.getQueryData(preferencesQueryKey);
				queryClient.setQueryData(
					preferencesQueryKey,
					(prev: UserPreferences | undefined): UserPreferences => ({ ...prev, toolCallDensity }),
				);
				return { previous };
			},
			onError: (_err, _vars, context) => {
				if (context) {
					queryClient.setQueryData(preferencesQueryKey, context.previous);
				}
			},
			onSettled: () => {
				queryClient.invalidateQueries({ queryKey: preferencesQueryKey });
			},
		}),
	);

	const storedDensity = preferencesQuery.data?.toolCallDensity;
	const density = getEffectiveToolCallDensity(storedDensity, toolCallDensityPolicy);
	const isLoading = isPolicyLoading || (!!session?.user && preferencesQuery.isPending);
	const canChange = !isPolicyLoading && toolCallDensityPolicy.canChange;

	const setDensity = useCallback(
		(toolCallDensity: ToolCallDensity) => {
			if (!canChange) {
				return;
			}
			updatePreferences({ toolCallDensity });
		},
		[canChange, updatePreferences],
	);

	return [density, setDensity, { canChange, isLoading }] as const;
};
