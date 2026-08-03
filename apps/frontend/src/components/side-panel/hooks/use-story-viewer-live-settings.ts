import { useCallback } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { trpc } from '@/main';

interface UseStoryViewerLiveSettingsParams {
	chatId: string;
	storySlug: string;
	shareId?: string;
}

export const useStoryViewerLiveSettings = ({ chatId, storySlug, shareId }: UseStoryViewerLiveSettingsParams) => {
	const queryClient = useQueryClient();
	const { data } = useQuery(trpc.story.listVersions.queryOptions({ chatId, storySlug }));

	const storyId = data?.id ?? null;
	const isLive = data?.isLive ?? false;
	const isLiveTextDynamic = data?.isLiveTextDynamic ?? true;
	const cacheSchedule = data?.cacheSchedule ?? null;
	const cacheScheduleDescription = data?.cacheScheduleDescription ?? null;

	const invalidateSharedStory = async () => {
		if (!shareId) {
			return;
		}
		await queryClient.invalidateQueries({
			queryKey: trpc.storyShare.get.queryKey({ shareId }),
		});
	};

	const updateLiveSettingsMutation = useMutation(
		trpc.story.updateLiveSettings.mutationOptions({
			onSuccess: () => {
				void queryClient.invalidateQueries({
					queryKey: trpc.story.listVersions.queryKey({ chatId, storySlug }),
				});
				void queryClient.invalidateQueries({
					queryKey: trpc.story.getLatest.queryKey({ chatId, storySlug }),
				});
				invalidateSharedStory();
			},
		}),
	);

	const refreshDataMutation = useMutation(
		trpc.story.refreshData.mutationOptions({
			onSettled: async () => {
				const invalidations = [
					queryClient.invalidateQueries({
						queryKey: trpc.story.listVersions.queryKey({ chatId, storySlug }),
					}),
					queryClient.invalidateQueries({
						queryKey: trpc.story.getLatest.queryKey({ chatId, storySlug }),
					}),
					queryClient.invalidateQueries({
						queryKey: trpc.automation.feed.queryKey(),
					}),
					invalidateSharedStory(),
				];
				if (storyId) {
					invalidations.push(
						queryClient.invalidateQueries({
							queryKey: trpc.story.getStandalone.queryKey({ storyId }),
						}),
					);
				}
				await Promise.all(invalidations);
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
		storyId,
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
