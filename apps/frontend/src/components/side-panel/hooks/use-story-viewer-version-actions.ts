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
	currentVersionTitle?: string;
	currentVersionCode?: string;
	isViewingLatest: boolean;
	tiptapEditorRef: MutableRefObject<TiptapEditor | null>;
	setViewMode: (mode: StoryViewMode) => void;
}

export const useStoryViewerVersionActions = ({
	chatId,
	storyId,
	currentVersionTitle,
	currentVersionCode,
	isViewingLatest,
	tiptapEditorRef,
	setViewMode,
}: UseStoryViewerVersionActionsParams) => {
	const queryClient = useQueryClient();

	const createVersionMutation = useMutation(
		trpc.story.createVersion.mutationOptions({
			onSuccess: () => {
				void queryClient.invalidateQueries({ queryKey: trpc.story.listVersions.queryKey({ chatId, storyId }) });
				void queryClient.invalidateQueries({ queryKey: trpc.story.listAll.queryKey() });
			},
		}),
	);

	const handleSave = useCallback(() => {
		const editor = tiptapEditorRef.current;
		const hasVersionData = currentVersionTitle !== undefined && currentVersionCode !== undefined;
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
			title: currentVersionTitle,
			code: newCode,
			action: 'replace',
		});

		setViewMode('preview');
	}, [chatId, storyId, currentVersionTitle, currentVersionCode, tiptapEditorRef, createVersionMutation, setViewMode]);

	const handleRestore = useCallback(() => {
		const hasVersionData = currentVersionTitle !== undefined && currentVersionCode !== undefined;
		if (!hasVersionData || isViewingLatest) {
			return;
		}

		createVersionMutation.mutate({
			chatId,
			storyId,
			title: currentVersionTitle,
			code: currentVersionCode,
			action: 'replace',
		});
	}, [chatId, storyId, currentVersionTitle, currentVersionCode, isViewingLatest, createVersionMutation]);

	return {
		handleSave,
		handleRestore,
	};
};
