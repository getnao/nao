import { useCallback, useEffect } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { replaceUniqueStoryBlockTag } from './story-chart-edit-utils';
import { trpc } from '@/main';

interface StoryBlockEditParams {
	chatId: string;
	storySlug: string;
	storyTitle: string;
	storyCode: string;
	storyVersion?: number;
}

export interface StoryBlockEdit {
	/** Replaces `rawTag` with `nextTag` in the story and saves a new version. */
	replaceBlock: (rawTag: string, nextTag: string) => Promise<void>;
	isSaving: boolean;
}

/** The save queue and freshest known code of one story, shared by its chart, table and map editors. */
interface StoryBlockSaveQueue {
	tail: Promise<void>;
	pendingSaves: number;
	subscribers: number;
	code: string;
	version?: number;
}

const saveQueues = new Map<string, StoryBlockSaveQueue>();

/**
 * Shared save pipeline for editable story embeds (charts, tables and maps). Every editor of a story
 * goes through the same queue, so saves run one at a time and each builds on the code and version
 * the previous one saved, whichever kind of embed it edited.
 */
export function useStoryBlockEdit({
	chatId,
	storySlug,
	storyTitle,
	storyCode,
	storyVersion,
}: StoryBlockEditParams): StoryBlockEdit {
	const queryClient = useQueryClient();
	const latestStoryQueryKey = trpc.story.getLatest.queryKey({ chatId, storySlug });
	const queueKey = `${chatId}/${storySlug}`;

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

	useEffect(() => {
		const queue = getSaveQueue(queueKey, storyCode, storyVersion);
		queue.subscribers += 1;
		if (queue.pendingSaves === 0) {
			queue.code = storyCode;
			queue.version = storyVersion;
		}
		return () => {
			queue.subscribers -= 1;
			releaseIdleSaveQueue(queueKey, queue);
		};
	}, [queueKey, storyCode, storyVersion]);

	const replaceBlock = useCallback(
		(rawTag: string, nextTag: string) => {
			const queue = getSaveQueue(queueKey, storyCode, storyVersion);
			queue.pendingSaves += 1;
			const run = queue.tail
				.then(async () => {
					const currentCode = queue.code;
					const nextCode = replaceUniqueStoryBlockTag(currentCode, rawTag, nextTag);
					if (nextCode === currentCode) {
						return;
					}
					queue.code = nextCode;
					try {
						const created = await createVersionMutation.mutateAsync({
							chatId,
							storySlug,
							title: storyTitle,
							code: nextCode,
							action: 'replace',
							basedOnVersion: queue.version,
						});
						queue.version = created.version;
					} catch (error) {
						queue.code = currentCode;
						throw error;
					}
				})
				.finally(() => {
					queue.pendingSaves -= 1;
					releaseIdleSaveQueue(queueKey, queue);
				});
			queue.tail = run.catch(() => {});
			return run;
		},
		[chatId, storySlug, storyTitle, storyCode, storyVersion, queueKey, createVersionMutation],
	);

	return { replaceBlock, isSaving: createVersionMutation.isPending };
}

function getSaveQueue(key: string, code: string, version: number | undefined): StoryBlockSaveQueue {
	const existing = saveQueues.get(key);
	if (existing) {
		return existing;
	}
	const queue: StoryBlockSaveQueue = { tail: Promise.resolve(), pendingSaves: 0, subscribers: 0, code, version };
	saveQueues.set(key, queue);
	return queue;
}

function releaseIdleSaveQueue(key: string, queue: StoryBlockSaveQueue): void {
	if (queue.subscribers === 0 && queue.pendingSaves === 0 && saveQueues.get(key) === queue) {
		saveQueues.delete(key);
	}
}
