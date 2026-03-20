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
	const cacheSchedule = latestVersion?.cacheSchedule ?? null;
	const refreshText = latestVersion?.refreshText ?? false;

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

	const handleSaveSettings = useCallback(
		(settings: { isLive: boolean; cacheSchedule: string | null; refreshText: boolean }) => {
			updateLiveSettingsMutation.mutate({ chatId, storyId, ...settings });
		},
		[chatId, storyId, updateLiveSettingsMutation],
	);

	const handleRefreshData = useCallback(() => {
		refreshDataMutation.mutate({ chatId, storyId });
	}, [chatId, storyId, refreshDataMutation]);

	return {
		isLive,
		cacheSchedule,
		refreshText,
		isUpdating: updateLiveSettingsMutation.isPending,
		isRefreshing: refreshDataMutation.isPending,
		handleSaveSettings,
		handleRefreshData,
	};
};
