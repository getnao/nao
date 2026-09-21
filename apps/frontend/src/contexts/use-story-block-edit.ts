import { useCallback, useEffect, useRef } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { replaceUniqueStoryBlockTag } from './story-chart-edit-utils';
import { trpc } from '@/main';

interface StoryBlockEditParams {
	chatId: string;
	storySlug: string;
	storyTitle: string;
	storyCode: string;
}

export interface StoryBlockEdit {
	/** Replaces `rawTag` with `nextTag` in the story and saves a new version. */
	replaceBlock: (rawTag: string, nextTag: string) => Promise<void>;
	isSaving: boolean;
}

/**
 * Shared save pipeline for editable story embeds (charts and tables). Saves are
 * serialized and each builds on the previous result via a code buffer, so
 * saving two embeds in quick succession never discards the earlier edit.
 */
export function useStoryBlockEdit({ chatId, storySlug, storyTitle, storyCode }: StoryBlockEditParams): StoryBlockEdit {
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

	// Mutable buffer of the freshest known story code. Kept in sync with the prop
	// (new versions loaded elsewhere) and updated eagerly on each queued save.
	const codeRef = useRef(storyCode);
	useEffect(() => {
		codeRef.current = storyCode;
	}, [storyCode]);

	// Serializes saves so a later one builds on the earlier one's applied code.
	const chainRef = useRef<Promise<void>>(Promise.resolve());

	const replaceBlock = useCallback(
		(rawTag: string, nextTag: string) => {
			const run = chainRef.current.then(async () => {
				const currentCode = codeRef.current;
				const nextCode = replaceUniqueStoryBlockTag(currentCode, rawTag, nextTag);
				if (nextCode === currentCode) {
					return;
				}
				codeRef.current = nextCode;
				try {
					await createVersionMutation.mutateAsync({
						chatId,
						storySlug,
						title: storyTitle,
						code: nextCode,
						action: 'replace',
					});
				} catch (error) {
					codeRef.current = currentCode;
					throw error;
				}
			});
			chainRef.current = run.catch(() => {});
			return run;
		},
		[chatId, storySlug, storyTitle, createVersionMutation],
	);

	return { replaceBlock, isSaving: createVersionMutation.isPending };
}
