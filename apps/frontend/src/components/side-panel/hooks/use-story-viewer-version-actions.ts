import { useCallback } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { getEditorMarkdown } from '../story-editor';
import type { MutableRefObject } from 'react';
import type { Editor as TiptapEditor } from '@tiptap/react';
import type { StoryViewMode } from '../story-viewer.types';
import type { StoryCodeViewHandle } from '../story-code-view';
import { trpc } from '@/main';

interface UseStoryViewerVersionActionsParams {
	chatId: string;
	storySlug: string;
	storyTitle?: string;
	currentVersionCode?: string;
	isViewingLatest: boolean;
	tiptapEditorRef: MutableRefObject<TiptapEditor | null>;
	codeViewRef: MutableRefObject<StoryCodeViewHandle | null>;
	viewMode: StoryViewMode;
	setViewMode: (mode: StoryViewMode) => void;
}

export const useStoryViewerVersionActions = ({
	chatId,
	storySlug,
	storyTitle,
	currentVersionCode,
	isViewingLatest,
	tiptapEditorRef,
	codeViewRef,
	viewMode,
	setViewMode,
}: UseStoryViewerVersionActionsParams) => {
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

	const handleSave = useCallback(() => {
		const hasVersionData = storyTitle !== undefined && currentVersionCode !== undefined;
		if (!hasVersionData) {
			return;
		}

		let newCode: string | null = null;
		if (viewMode === 'edit') {
			const editor = tiptapEditorRef.current;
			if (!editor) {
				return;
			}
			newCode = getEditorMarkdown(editor);
		} else if (viewMode === 'code') {
			const codeView = codeViewRef.current;
			if (!codeView) {
				return;
			}
			if (codeView.getErrors().length > 0) {
				return;
			}
			newCode = codeView.getCode();
		}

		if (newCode === null) {
			return;
		}

		if (newCode === currentVersionCode) {
			setViewMode('preview');
			return;
		}

		createVersionMutation.mutate({
			chatId,
			storySlug,
			title: storyTitle,
			code: newCode,
			action: 'replace',
		});

		setViewMode('preview');
	}, [
		chatId,
		storySlug,
		storyTitle,
		currentVersionCode,
		tiptapEditorRef,
		codeViewRef,
		viewMode,
		createVersionMutation,
		setViewMode,
	]);

	const handleRestore = useCallback(() => {
		const hasVersionData = storyTitle !== undefined && currentVersionCode !== undefined;
		if (!hasVersionData || isViewingLatest) {
			return;
		}

		createVersionMutation.mutate({
			chatId,
			storySlug,
			title: storyTitle,
			code: currentVersionCode,
			action: 'replace',
		});
	}, [chatId, storySlug, storyTitle, currentVersionCode, isViewingLatest, createVersionMutation]);

	return {
		handleSave,
		handleRestore,
	};
};
