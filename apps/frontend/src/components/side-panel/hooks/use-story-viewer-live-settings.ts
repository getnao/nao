import { useCallback } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useIsStoryRefreshing } from '@/hooks/use-is-story-refreshing';
import { trpc } from '@/main';

interface UseStoryViewerLiveSettingsParams {
	chatId: string;
	storySlug: string;
	enabled?: boolean;
}

export const useStoryViewerLiveSettings = ({ chatId, storySlug, enabled = true }: UseStoryViewerLiveSettingsParams) => {
	const queryClient = useQueryClient();
	const { data } = useQuery({ ...trpc.story.listVersions.queryOptions({ chatId, storySlug }), enabled });

	const storyId = data?.id ?? null;
	const isLive = data?.isLive ?? false;
	const isLiveTextDynamic = data?.isLiveTextDynamic ?? true;
	const cacheSchedule = data?.cacheSchedule ?? null;
	const cacheScheduleDescription = data?.cacheScheduleDescription ?? null;

	const invalidateCustomStory = () =>
		Promise.all([
			queryClient.invalidateQueries({ queryKey: trpc.story.getCustomVersion.queryKey({ chatId, storySlug }) }),
			queryClient.invalidateQueries({
				queryKey: trpc.story.getCustomStoryQueryData.queryKey({ chatId, storySlug }),
			}),
			queryClient.invalidateQueries({
				queryKey: trpc.story.getCustomStoryNarratives.queryKey({ chatId, storySlug }),
			}),
		]);

	const updateLiveSettingsMutation = useMutation(
		trpc.story.updateLiveSettings.mutationOptions({
			onSuccess: async () => {
				await Promise.all([
					queryClient.invalidateQueries({
						queryKey: trpc.story.listVersions.queryKey({ chatId, storySlug }),
					}),
					queryClient.invalidateQueries({
						queryKey: trpc.story.getLatest.queryKey({ chatId, storySlug }),
					}),
					invalidateCustomStory(),
				]);
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
					invalidateCustomStory(),
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
		async (settings: {
			isLive: boolean;
			isLiveTextDynamic: boolean;
			cacheSchedule: string | null;
			cacheScheduleDescription: string | null;
		}) => {
			await updateLiveSettingsMutation.mutateAsync({ chatId, storySlug, ...settings });
		},
		[chatId, storySlug, updateLiveSettingsMutation],
	);

	const handleRefreshData = useCallback(() => {
		refreshDataMutation.mutate({ chatId, storySlug });
	}, [chatId, storySlug, refreshDataMutation]);
	const isRefreshing = useIsStoryRefreshing(trpc.story.refreshData.mutationKey(), { chatId, storySlug });

	return {
		storyId,
		isLive,
		isLiveTextDynamic,
		cacheSchedule,
		cacheScheduleDescription,
		isUpdating: updateLiveSettingsMutation.isPending,
		isRefreshing,
		handleSaveSettings,
		handleRefreshData,
	};
};
