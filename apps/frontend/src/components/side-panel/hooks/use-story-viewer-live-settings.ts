import { useCallback } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { trpc } from '@/main';

interface UseStoryViewerLiveSettingsParams {
	chatId: string;
	storySlug: string;
}

export const useStoryViewerLiveSettings = ({ chatId, storySlug }: UseStoryViewerLiveSettingsParams) => {
	const queryClient = useQueryClient();
	const { data } = useQuery(trpc.story.listVersions.queryOptions({ chatId, storySlug }));

	const isLive = data?.isLive ?? false;
	const isLiveTextDynamic = data?.isLiveTextDynamic ?? true;
	const cacheSchedule = data?.cacheSchedule ?? null;
	const cacheScheduleDescription = data?.cacheScheduleDescription ?? null;

	const updateLiveSettingsMutation = useMutation(
		trpc.story.updateLiveSettings.mutationOptions({
			onSuccess: () => {
				void queryClient.invalidateQueries({
					queryKey: trpc.story.listVersions.queryKey({ chatId, storySlug }),
				});
				void queryClient.invalidateQueries({
					queryKey: trpc.story.getLatest.queryKey({ chatId, storySlug }),
				});
			},
		}),
	);

	const refreshDataMutation = useMutation(
		trpc.story.refreshData.mutationOptions({
			onSuccess: () => {
				void queryClient.invalidateQueries({
					queryKey: trpc.story.listVersions.queryKey({ chatId, storySlug }),
				});
				void queryClient.invalidateQueries({
					queryKey: trpc.story.getLatest.queryKey({ chatId, storySlug }),
				});
			},
		}),
	);

	const handleSaveSettings = useCallback(
		(settings: {
			isLive: boolean;
			isLiveTextDynamic: boolean;
			cacheSchedule: string | null;
			cacheScheduleDescription: string | null;
		}) => {
			updateLiveSettingsMutation.mutate({ chatId, storySlug, ...settings });
		},
		[chatId, storySlug, updateLiveSettingsMutation],
	);

	const handleRefreshData = useCallback(() => {
		refreshDataMutation.mutate({ chatId, storySlug });
	}, [chatId, storySlug, refreshDataMutation]);

	return {
		isLive,
		isLiveTextDynamic,
		cacheSchedule,
		cacheScheduleDescription,
		isUpdating: updateLiveSettingsMutation.isPending,
		isRefreshing: refreshDataMutation.isPending,
		handleSaveSettings,
		handleRefreshData,
	};
};
