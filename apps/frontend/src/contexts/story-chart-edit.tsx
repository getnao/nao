import { createContext, useCallback, useContext, useMemo } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { buildStoryChartBlock } from '@nao/shared';
import { replaceUniqueChartTag } from './story-chart-edit-utils';
import type { displayChart } from '@nao/shared/tools';
import { trpc } from '@/main';

export interface StoryChartEditHandlers {
	/**
	 * Persists a new chart config by replacing `rawTag` (the original `<chart ... />` tag)
	 * in the story's markdown and saving a new version.
	 * Returns a promise that rejects if the save fails.
	 */
	saveChart: (rawTag: string, config: displayChart.Input) => Promise<void>;
	/** Whether a save is currently in flight. */
	isSaving: boolean;
}

const StoryChartEditContext = createContext<StoryChartEditHandlers | null>(null);

export const useStoryChartEdit = () => useContext(StoryChartEditContext);

interface StoryChartEditProviderProps {
	chatId: string;
	storySlug: string;
	storyTitle: string;
	storyCode: string;
	children: React.ReactNode;
}

/**
 * Provides a `saveChart` handler that chart embeds inside a story can call to persist
 * edits (title/type/series/etc) back to the story via `story.createVersion`.
 */
export function StoryChartEditProvider({
	chatId,
	storySlug,
	storyTitle,
	storyCode,
	children,
}: StoryChartEditProviderProps) {
	const queryClient = useQueryClient();
	const latestStoryQueryKey = trpc.story.getLatest.queryKey({ chatId, storySlug });

	const createVersionMutation = useMutation(
		trpc.story.createVersion.mutationOptions({
			onMutate: async (variables) => {
				await queryClient.cancelQueries({ queryKey: latestStoryQueryKey });
				const previousLatestStory = queryClient.getQueryData(latestStoryQueryKey);
				queryClient.setQueryData(latestStoryQueryKey, (latestStory) =>
					latestStory && typeof latestStory === 'object'
						? { ...latestStory, code: variables.code }
						: latestStory,
				);
				return { previousLatestStory };
			},
			onError: (_error, _variables, context) => {
				if (context?.previousLatestStory !== undefined) {
					queryClient.setQueryData(latestStoryQueryKey, context.previousLatestStory);
				}
			},
			onSuccess: () => {
				void queryClient.invalidateQueries({
					queryKey: trpc.story.listVersions.queryKey({ chatId, storySlug }),
				});
				void queryClient.invalidateQueries({ queryKey: trpc.story.listAll.queryKey() });
				void queryClient.invalidateQueries({ queryKey: latestStoryQueryKey });
			},
		}),
	);

	const saveChart = useCallback(
		async (rawTag: string, config: displayChart.Input) => {
			const nextTag = buildStoryChartBlock(config);
			const nextCode = replaceUniqueChartTag(storyCode, rawTag, nextTag);
			if (nextCode === storyCode) {
				return;
			}
			await createVersionMutation.mutateAsync({
				chatId,
				storySlug,
				title: storyTitle,
				code: nextCode,
				action: 'replace',
			});
		},
		[chatId, storySlug, storyTitle, storyCode, createVersionMutation],
	);

	const value = useMemo<StoryChartEditHandlers>(
		() => ({ saveChart, isSaving: createVersionMutation.isPending }),
		[saveChart, createVersionMutation.isPending],
	);

	return <StoryChartEditContext.Provider value={value}>{children}</StoryChartEditContext.Provider>;
}
