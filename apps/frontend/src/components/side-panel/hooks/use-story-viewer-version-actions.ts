import { useCallback } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { getEditorMarkdown } from '../story-editor';
import type { MutableRefObject } from 'react';
import type { Editor as TiptapEditor } from '@tiptap/react';
import type { StoryViewMode } from '../story-viewer.types';
import { trpc } from '@/main';

interface UseStoryViewerVersionActionsParams {
	chatId: string;
	storyId: string;
	storyTitle?: string;
	currentVersionCode?: string;
	isViewingLatest: boolean;
	tiptapEditorRef: MutableRefObject<TiptapEditor | null>;
	setViewMode: (mode: StoryViewMode) => void;
}

export const useStoryViewerVersionActions = ({
	chatId,
	storyId,
	storyTitle,
	currentVersionCode,
	isViewingLatest,
	tiptapEditorRef,
	setViewMode,
}: UseStoryViewerVersionActionsParams) => {
	const queryClient = useQueryClient();
	const latestStoryQueryKey = trpc.story.getLatest.queryKey({ chatId, storyId });

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
				void queryClient.invalidateQueries({ queryKey: trpc.story.listVersions.queryKey({ chatId, storyId }) });
				void queryClient.invalidateQueries({ queryKey: trpc.story.listAll.queryKey() });
				void queryClient.invalidateQueries({ queryKey: latestStoryQueryKey });
			},
		}),
	);

	const handleSave = useCallback(() => {
		const editor = tiptapEditorRef.current;
		const hasVersionData = storyTitle !== undefined && currentVersionCode !== undefined;
		if (!editor || !hasVersionData) {
			return;
		}

		const newCode = getEditorMarkdown(editor);
		if (newCode === currentVersionCode) {
			setViewMode('preview');
			return;
		}

		createVersionMutation.mutate({
			chatId,
			storyId,
			title: storyTitle,
			code: newCode,
			action: 'replace',
		});

		setViewMode('preview');
	}, [chatId, storyId, storyTitle, currentVersionCode, tiptapEditorRef, createVersionMutation, setViewMode]);

	const handleRestore = useCallback(() => {
		const hasVersionData = storyTitle !== undefined && currentVersionCode !== undefined;
		if (!hasVersionData || isViewingLatest) {
			return;
		}

		createVersionMutation.mutate({
			chatId,
			storyId,
			title: storyTitle,
			code: currentVersionCode,
			action: 'replace',
		});
	}, [chatId, storyId, storyTitle, currentVersionCode, isViewingLatest, createVersionMutation]);

	return {
		handleSave,
		handleRestore,
	};
};
