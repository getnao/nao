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
	getEditModeCode?: () => string | null;
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
	getEditModeCode,
	viewMode,
	setViewMode,
}: UseStoryViewerVersionActionsParams) => {
	const queryClient = useQueryClient();
	const latestStoryQueryKey = trpc.story.getLatest.queryKey({ chatId, storySlug });
	const listVersionsQueryKey = trpc.story.listVersions.queryKey({ chatId, storySlug });

	const createVersionMutation = useMutation(
		trpc.story.createVersion.mutationOptions({
			onMutate: async (variables) => {
				const previousLatestStory = queryClient.getQueryData(latestStoryQueryKey);
				const previousVersions = queryClient.getQueryData(listVersionsQueryKey);
				queryClient.setQueryData(latestStoryQueryKey, (latestStory) =>
					latestStory && typeof latestStory === 'object'
						? { ...latestStory, code: variables.code }
						: latestStory,
				);
				queryClient.setQueryData(listVersionsQueryKey, (data) => {
					if (!data || !Array.isArray(data.versions) || data.versions.length === 0) {
						return data;
					}
					const lastVersion = data.versions[data.versions.length - 1];
					return {
						...data,
						versions: [...data.versions, { ...lastVersion, code: variables.code }],
					};
				});

				await queryClient.cancelQueries({ queryKey: latestStoryQueryKey });
				await queryClient.cancelQueries({ queryKey: listVersionsQueryKey });

				return { previousLatestStory, previousVersions };
			},
			onError: (_error, _variables, context) => {
				if (context?.previousLatestStory !== undefined) {
					queryClient.setQueryData(latestStoryQueryKey, context.previousLatestStory);
				}
				if (context?.previousVersions !== undefined) {
					queryClient.setQueryData(listVersionsQueryKey, context.previousVersions);
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
			const override = getEditModeCode?.();
			if (override != null) {
				newCode = override;
			} else {
				const editor = tiptapEditorRef.current;
				if (!editor) {
					return;
				}
				newCode = getEditorMarkdown(editor);
			}
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
		getEditModeCode,
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
		isSaving: createVersionMutation.isPending,
	};
};
