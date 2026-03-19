import { useCallback, useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { trpc } from '@/main';

interface UseStoryViewerLiveSettingsParams {
	chatId: string;
	storyId: string;
}

export const useStoryViewerLiveSettings = ({ chatId, storyId }: UseStoryViewerLiveSettingsParams) => {
	const queryClient = useQueryClient();
	const versionsQuery = useQuery(trpc.story.listVersions.queryOptions({ chatId, storyId }));
	const latestVersion = useMemo(() => versionsQuery.data?.at(-1), [versionsQuery.data]);

	const isLive = latestVersion?.isLive ?? false;
	const cacheTtlMinutes = latestVersion?.cacheTtlMinutes ?? null;

	const updateLiveSettingsMutation = useMutation(
		trpc.story.updateLiveSettings.mutationOptions({
			onSuccess: () => {
				void queryClient.invalidateQueries({
					queryKey: trpc.story.listVersions.queryKey({ chatId, storyId }),
				});
				void queryClient.invalidateQueries({
					queryKey: trpc.story.getLatest.queryKey({ chatId, storyId }),
				});
			},
		}),
	);

	const refreshDataMutation = useMutation(
		trpc.story.refreshData.mutationOptions({
			onSuccess: () => {
				void queryClient.invalidateQueries({
					queryKey: trpc.story.getLatest.queryKey({ chatId, storyId }),
				});
			},
		}),
	);

	const handleToggleLive = useCallback(
		(newIsLive: boolean) => {
			updateLiveSettingsMutation.mutate({
				chatId,
				storyId,
				isLive: newIsLive,
				cacheTtlMinutes: newIsLive ? cacheTtlMinutes : null,
			});
		},
		[chatId, storyId, cacheTtlMinutes, updateLiveSettingsMutation],
	);

	const handleUpdateCacheTtl = useCallback(
		(newTtl: number | null) => {
			updateLiveSettingsMutation.mutate({
				chatId,
				storyId,
				isLive,
				cacheTtlMinutes: newTtl,
			});
		},
		[chatId, storyId, isLive, updateLiveSettingsMutation],
	);

	const handleRefreshData = useCallback(() => {
		refreshDataMutation.mutate({ chatId, storyId });
	}, [chatId, storyId, refreshDataMutation]);

	return {
		isLive,
		cacheTtlMinutes,
		isUpdating: updateLiveSettingsMutation.isPending,
		isRefreshing: refreshDataMutation.isPending,
		handleToggleLive,
		handleUpdateCacheTtl,
		handleRefreshData,
	};
};
