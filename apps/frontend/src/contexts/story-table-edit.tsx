import { createContext, useCallback, useContext, useMemo } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { buildStoryTableBlock } from '@nao/shared';
import { replaceUniqueChartTag } from './story-chart-edit-utils';
import type { StoryTableBlockInput } from '@nao/shared';
import { trpc } from '@/main';

export interface StoryTableEditHandlers {
	/**
	 * Persists new table formatting by replacing `rawTag` (the original `<table ... />`
	 * tag) in the story's markdown and saving a new version. Rejects if the save fails.
	 */
	saveTable: (rawTag: string, config: StoryTableBlockInput) => Promise<void>;
	/** Whether a save is currently in flight. */
	isSaving: boolean;
}

const StoryTableEditContext = createContext<StoryTableEditHandlers | null>(null);

export const useStoryTableEdit = () => useContext(StoryTableEditContext);

interface StoryTableEditProviderProps {
	chatId: string;
	storySlug: string;
	storyTitle: string;
	storyCode: string;
	children: React.ReactNode;
}

/**
 * Provides a `saveTable` handler that table embeds inside a story can call to
 * persist conditional-formatting edits back to the story via `story.createVersion`.
 */
export function StoryTableEditProvider({
	chatId,
	storySlug,
	storyTitle,
	storyCode,
	children,
}: StoryTableEditProviderProps) {
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

	const saveTable = useCallback(
		async (rawTag: string, config: StoryTableBlockInput) => {
			const nextTag = buildStoryTableBlock(config);
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

	const value = useMemo<StoryTableEditHandlers>(
		() => ({ saveTable, isSaving: createVersionMutation.isPending }),
		[saveTable, createVersionMutation.isPending],
	);

	return <StoryTableEditContext.Provider value={value}>{children}</StoryTableEditContext.Provider>;
}
