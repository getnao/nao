import { useCallback, useMemo } from 'react';
import { skipToken, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useIsStoryRefreshing } from '@/hooks/use-is-story-refreshing';
import { trpc } from '@/main';

export type LiveStoryTarget = { chatId: string; storySlug: string } | { storyId: string };

type UseStoryViewerLiveSettingsParams = LiveStoryTarget & { enabled?: boolean };

interface LiveSettings {
	isLive: boolean;
	isLiveTextDynamic: boolean;
	cacheSchedule: string | null;
	cacheScheduleDescription: string | null;
}

export const useStoryViewerLiveSettings = (params: UseStoryViewerLiveSettingsParams) => {
	const { enabled = true } = params;
	const { chatStory, standaloneStory } = useLiveStoryTarget(params);
	const queryClient = useQueryClient();
	const chatSettingsQuery = useQuery({ ...trpc.story.listVersions.queryOptions(chatStory ?? skipToken), enabled });
	const standaloneSettingsQuery = useQuery({
		...trpc.story.getStandaloneLiveSettings.queryOptions(standaloneStory ?? skipToken),
		enabled,
	});
	const data = chatStory ? chatSettingsQuery.data : standaloneSettingsQuery.data;

	const storyId = data?.id ?? null;
	const isLive = data?.isLive ?? false;
	const isLiveTextDynamic = data?.isLiveTextDynamic ?? true;
	const cacheSchedule = data?.cacheSchedule ?? null;
	const cacheScheduleDescription = data?.cacheScheduleDescription ?? null;

	const invalidateChatStory = (input: { chatId: string; storySlug: string }) => {
		return Promise.all([
			queryClient.invalidateQueries({ queryKey: trpc.story.listVersions.queryKey(input) }),
			queryClient.invalidateQueries({ queryKey: trpc.story.getLatest.queryKey(input) }),
			queryClient.invalidateQueries({ queryKey: trpc.story.getCustomVersion.queryKey(input) }),
			queryClient.invalidateQueries({ queryKey: trpc.story.getCustomStoryQueryData.queryKey(input) }),
			queryClient.invalidateQueries({ queryKey: trpc.story.getCustomStoryNarratives.queryKey(input) }),
		]);
	};

	const invalidateStandaloneStory = (input: { storyId: string }) => {
		return Promise.all([
			queryClient.invalidateQueries({ queryKey: trpc.story.getStandaloneLiveSettings.queryKey(input) }),
			queryClient.invalidateQueries({ queryKey: trpc.story.getStandalone.queryKey(input) }),
			queryClient.invalidateQueries({ queryKey: trpc.story.listStandaloneVersions.queryKey(input) }),
			queryClient.invalidateQueries({ queryKey: trpc.story.getStandaloneVersionQueryData.queryKey(input) }),
			queryClient.invalidateQueries({ queryKey: trpc.standaloneCustomStory.pathKey() }),
		]);
	};

	const invalidateStory = () => {
		if (chatStory) {
			return invalidateChatStory(chatStory);
		}
		return standaloneStory ? invalidateStandaloneStory(standaloneStory) : Promise.resolve();
	};

	const invalidateLiveQueryData = () => {
		if (chatStory) {
			return queryClient.invalidateQueries({ queryKey: trpc.story.getLiveQueryData.queryKey(chatStory) });
		}
		return standaloneStory
			? queryClient.invalidateQueries({
					queryKey: trpc.story.getStandaloneLiveQueryData.queryKey(standaloneStory),
				})
			: Promise.resolve();
	};

	const invalidateRefreshedStory = () => {
		const invalidations: Promise<unknown>[] = [
			invalidateStory(),
			invalidateLiveQueryData(),
			queryClient.invalidateQueries({ queryKey: trpc.automation.feed.queryKey() }),
		];
		if (chatStory && storyId) {
			invalidations.push(
				queryClient.invalidateQueries({ queryKey: trpc.story.getStandalone.queryKey({ storyId }) }),
			);
		}
		return Promise.all(invalidations);
	};

	const updateLiveSettingsMutation = useMutation(
		trpc.story.updateLiveSettings.mutationOptions({ onSuccess: invalidateStory }),
	);
	const updateStandaloneLiveSettingsMutation = useMutation(
		trpc.story.updateStandaloneLiveSettings.mutationOptions({ onSuccess: invalidateStory }),
	);
	const refreshDataMutation = useMutation(
		trpc.story.refreshData.mutationOptions({ onSettled: invalidateRefreshedStory }),
	);
	const refreshStandaloneDataMutation = useMutation(
		trpc.story.refreshStandaloneData.mutationOptions({ onSettled: invalidateRefreshedStory }),
	);

	const handleSaveSettings = useCallback(
		async (settings: LiveSettings) => {
			if (chatStory) {
				await updateLiveSettingsMutation.mutateAsync({ ...chatStory, ...settings });
			} else if (standaloneStory) {
				await updateStandaloneLiveSettingsMutation.mutateAsync({ ...standaloneStory, ...settings });
			}
		},
		[chatStory, standaloneStory, updateLiveSettingsMutation, updateStandaloneLiveSettingsMutation],
	);

	const handleRefreshData = useCallback(() => {
		if (chatStory) {
			refreshDataMutation.mutate(chatStory);
		} else if (standaloneStory) {
			refreshStandaloneDataMutation.mutate(standaloneStory);
		}
	}, [chatStory, standaloneStory, refreshDataMutation, refreshStandaloneDataMutation]);
	const isChatStoryRefreshing = useIsStoryRefreshing(trpc.story.refreshData.mutationKey(), chatStory ?? {});
	const isStandaloneStoryRefreshing = useIsStoryRefreshing(
		trpc.story.refreshStandaloneData.mutationKey(),
		standaloneStory ?? {},
	);
	const isRefreshing = chatStory ? isChatStoryRefreshing : isStandaloneStoryRefreshing;

	return {
		storyId,
		isLive,
		isLiveTextDynamic,
		cacheSchedule,
		cacheScheduleDescription,
		isUpdating: updateLiveSettingsMutation.isPending || updateStandaloneLiveSettingsMutation.isPending,
		isRefreshing,
		handleSaveSettings,
		handleRefreshData,
	};
};

function useLiveStoryTarget(target: LiveStoryTarget) {
	const storyId = 'storyId' in target ? target.storyId : null;
	const chatId = 'storyId' in target ? null : target.chatId;
	const storySlug = 'storyId' in target ? null : target.storySlug;
	return useMemo(
		() => ({
			chatStory: chatId !== null && storySlug !== null ? { chatId, storySlug } : null,
			standaloneStory: storyId !== null ? { storyId } : null,
		}),
		[chatId, storySlug, storyId],
	);
}
