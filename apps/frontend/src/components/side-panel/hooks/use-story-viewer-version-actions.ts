import { useCallback, useEffect, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { getEditorMarkdown } from '../story-editor';
import type { MutableRefObject } from 'react';
import type { Editor as TiptapEditor } from '@tiptap/react';
import type { StoryViewMode } from '../story-viewer.types';
import type { StoryCodeViewHandle } from '../story-code-view';
import type { StorySaveResult } from '@/lib/story-save';
import { saveStoryCodeIfChanged } from '@/lib/story-save';
import { trpc } from '@/main';

interface UseStoryViewerVersionActionsParams {
	chatId: string;
	storySlug: string;
	storyTitle?: string;
	currentVersionCode?: string;
	isViewingLatest: boolean;
	goToLatestVersion: () => void;
	tiptapEditorRef: MutableRefObject<TiptapEditor | null>;
	codeViewRef: MutableRefObject<StoryCodeViewHandle | null>;
	getEditModeCode?: () => string | null;
	viewMode: StoryViewMode;
	setViewMode: (mode: StoryViewMode) => void;
	onVersionSaved?: (code: string) => void;
}

export const useStoryViewerVersionActions = ({
	chatId,
	storySlug,
	storyTitle,
	currentVersionCode,
	isViewingLatest,
	goToLatestVersion,
	tiptapEditorRef,
	codeViewRef,
	getEditModeCode,
	viewMode,
	setViewMode,
	onVersionSaved,
}: UseStoryViewerVersionActionsParams) => {
	const queryClient = useQueryClient();
	const latestStoryQueryKey = trpc.story.getLatest.queryKey({ chatId, storySlug });
	const listVersionsQueryKey = trpc.story.listVersions.queryKey({ chatId, storySlug });
	const identity = `${chatId}:${storySlug}`;
	const baselineRef = useRef({ identity, code: currentVersionCode });
	const savePromiseRef = useRef<Promise<StorySaveResult> | null>(null);
	const [isSavingVersion, setIsSavingVersion] = useState(false);
	const paramsRef = useRef({
		chatId,
		storySlug,
		storyTitle,
		currentVersionCode,
		getEditModeCode,
		viewMode,
		onVersionSaved,
	});

	if (baselineRef.current.identity !== identity) {
		baselineRef.current = { identity, code: currentVersionCode };
	}
	paramsRef.current = {
		chatId,
		storySlug,
		storyTitle,
		currentVersionCode,
		getEditModeCode,
		viewMode,
		onVersionSaved,
	};

	const createVersionMutation = useMutation(trpc.story.createVersion.mutationOptions());
	const mutationRef = useRef(createVersionMutation);
	mutationRef.current = createVersionMutation;
	const refreshQueries = useCallback(async () => {
		await Promise.all([
			queryClient.invalidateQueries({ queryKey: listVersionsQueryKey }),
			queryClient.invalidateQueries({ queryKey: trpc.story.listAll.queryKey() }),
			queryClient.invalidateQueries({ queryKey: latestStoryQueryKey }),
		]);
	}, [latestStoryQueryKey, listVersionsQueryKey, queryClient]);
	const refreshQueriesRef = useRef(refreshQueries);
	refreshQueriesRef.current = refreshQueries;

	useEffect(() => {
		if (currentVersionCode !== undefined && savePromiseRef.current === null) {
			baselineRef.current = { identity, code: currentVersionCode };
		}
	}, [currentVersionCode, identity]);

	const readCurrentCode = useCallback((): { code: string } | StorySaveResult => {
		const params = paramsRef.current;
		if (params.storyTitle === undefined || params.currentVersionCode === undefined) {
			return 'unavailable';
		}
		if (params.viewMode === 'edit') {
			const trackedCode = params.getEditModeCode?.();
			if (trackedCode != null) {
				return { code: trackedCode };
			}
			const editor = tiptapEditorRef.current;
			return editor ? { code: getEditorMarkdown(editor) } : 'unavailable';
		}
		if (params.viewMode === 'code') {
			const codeView = codeViewRef.current;
			if (!codeView) {
				return 'unavailable';
			}
			if (codeView.getErrors().length > 0) {
				return 'invalid';
			}
			return { code: codeView.getCode() };
		}
		return 'unavailable';
	}, [codeViewRef, tiptapEditorRef]);

	const saveCurrentVersion = useCallback(() => {
		if (savePromiseRef.current) {
			return savePromiseRef.current;
		}

		const save = async (): Promise<StorySaveResult> => {
			let saved = false;
			while (true) {
				const snapshot = readCurrentCode();
				if (typeof snapshot === 'string') {
					return snapshot;
				}
				const params = paramsRef.current;
				const result = await saveStoryCodeIfChanged({
					baselineCode: baselineRef.current.code,
					code: snapshot.code,
					persist: async () => {
						await mutationRef.current.mutateAsync({
							chatId: params.chatId,
							storySlug: params.storySlug,
							title: params.storyTitle!,
							code: snapshot.code,
							action: 'replace',
						});
					},
				});
				if (result !== 'saved') {
					if (saved && result === 'unchanged') {
						await refreshQueriesRef.current();
						const refreshedSnapshot = readCurrentCode();
						if (typeof refreshedSnapshot === 'string') {
							return refreshedSnapshot;
						}
						if (refreshedSnapshot.code !== baselineRef.current.code) {
							continue;
						}
						return 'saved';
					}
					return result;
				}

				baselineRef.current = { identity: `${params.chatId}:${params.storySlug}`, code: snapshot.code };
				params.onVersionSaved?.(snapshot.code);
				saved = true;
			}
		};

		setIsSavingVersion(true);
		const promise = save().finally(() => {
			savePromiseRef.current = null;
			setIsSavingVersion(false);
		});
		savePromiseRef.current = promise;
		return promise;
	}, [readCurrentCode]);

	const handleSave = useCallback(async () => {
		const result = await saveCurrentVersion();
		if (result === 'saved' || result === 'unchanged') {
			setViewMode('preview');
		}
	}, [saveCurrentVersion, setViewMode]);

	const handleRestore = useCallback(() => {
		const hasVersionData = storyTitle !== undefined && currentVersionCode !== undefined;
		if (!hasVersionData || isViewingLatest || createVersionMutation.isPending) {
			return;
		}

		createVersionMutation.mutate(
			{
				chatId,
				storySlug,
				title: storyTitle,
				code: currentVersionCode,
				action: 'replace',
			},
			{
				onSuccess: async () => {
					await refreshQueries();
					goToLatestVersion();
				},
			},
		);
	}, [
		chatId,
		storySlug,
		storyTitle,
		currentVersionCode,
		isViewingLatest,
		createVersionMutation,
		refreshQueries,
		goToLatestVersion,
	]);

	return {
		handleSave,
		saveCurrentVersion,
		handleRestore,
		isSaving: createVersionMutation.isPending || isSavingVersion,
	};
};
