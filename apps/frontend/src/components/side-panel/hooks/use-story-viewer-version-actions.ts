import { useCallback, useEffect, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { MutableRefObject } from 'react';
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
	codeViewRef: MutableRefObject<StoryCodeViewHandle | null>;
	getCurrentCode: () => string;
	viewMode: StoryViewMode;
	setViewMode: (mode: StoryViewMode) => void;
	onVersionSaved?: (code: string) => void;
}

interface StoryIdentity {
	chatId: string;
	storySlug: string;
}

export const useStoryViewerVersionActions = ({
	chatId,
	storySlug,
	storyTitle,
	currentVersionCode,
	isViewingLatest,
	goToLatestVersion,
	codeViewRef,
	getCurrentCode,
	viewMode,
	setViewMode,
	onVersionSaved,
}: UseStoryViewerVersionActionsParams) => {
	const queryClient = useQueryClient();
	const latestStoryQueryKey = trpc.story.getLatest.queryKey({ chatId, storySlug });
	const listVersionsQueryKey = trpc.story.listVersions.queryKey({ chatId, storySlug });
	const identity = { chatId, storySlug };
	const currentIdentityRef = useRef(identity);
	const baselineRef = useRef({ identity, code: currentVersionCode });
	const savePromiseRef = useRef<{ identity: StoryIdentity; promise: Promise<StorySaveResult> } | null>(null);
	const [isSavingVersion, setIsSavingVersion] = useState(false);
	const paramsRef = useRef({
		identity,
		chatId,
		storySlug,
		storyTitle,
		currentVersionCode,
		getCurrentCode,
		viewMode,
		onVersionSaved,
	});

	currentIdentityRef.current = identity;
	if (!isSameStoryIdentity(baselineRef.current.identity, identity)) {
		baselineRef.current = { identity, code: currentVersionCode };
	}
	paramsRef.current = {
		identity,
		chatId,
		storySlug,
		storyTitle,
		currentVersionCode,
		getCurrentCode,
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
		const activeSave = savePromiseRef.current;
		const hasActiveSaveForStory =
			activeSave !== null && isSameStoryIdentity(activeSave.identity, { chatId, storySlug });
		if (currentVersionCode !== undefined && !hasActiveSaveForStory) {
			baselineRef.current = { identity: { chatId, storySlug }, code: currentVersionCode };
		}
	}, [chatId, currentVersionCode, storySlug]);

	const readCurrentCode = useCallback(
		(saveIdentity: StoryIdentity): { code: string } | StorySaveResult => {
			if (!isSameStoryIdentity(currentIdentityRef.current, saveIdentity)) {
				return 'unavailable';
			}
			const params = paramsRef.current;
			if (!isSameStoryIdentity(params.identity, saveIdentity)) {
				return 'unavailable';
			}
			if (params.storyTitle === undefined || params.currentVersionCode === undefined) {
				return 'unavailable';
			}
			if (params.viewMode === 'code') {
				const codeView = codeViewRef.current;
				if (!codeView) {
					return 'unavailable';
				}
				if (codeView.getErrors().length > 0) {
					return 'invalid';
				}
			}
			return { code: params.getCurrentCode() };
		},
		[codeViewRef],
	);

	const saveCurrentVersion = useCallback(() => {
		const params = paramsRef.current;
		const saveIdentity = params.identity;
		const activeSave = savePromiseRef.current;
		if (activeSave) {
			return isSameStoryIdentity(activeSave.identity, saveIdentity)
				? activeSave.promise
				: Promise.resolve<StorySaveResult>('unavailable');
		}

		if (params.storyTitle === undefined || params.currentVersionCode === undefined) {
			return Promise.resolve<StorySaveResult>('unavailable');
		}

		const saveTarget = {
			identity: saveIdentity,
			chatId: params.chatId,
			storySlug: params.storySlug,
			storyTitle: params.storyTitle,
			onVersionSaved: params.onVersionSaved,
			persist: mutationRef.current.mutateAsync,
			refreshQueries: refreshQueriesRef.current,
		};
		const isSaveIdentityActive = () => isSameStoryIdentity(currentIdentityRef.current, saveTarget.identity);

		const save = async (): Promise<StorySaveResult> => {
			let saved = false;
			while (true) {
				if (!isSaveIdentityActive()) {
					return 'unavailable';
				}

				const snapshot = readCurrentCode(saveTarget.identity);
				if (typeof snapshot === 'string') {
					return snapshot;
				}
				if (!isSameStoryIdentity(baselineRef.current.identity, saveTarget.identity)) {
					return 'unavailable';
				}

				const result = await saveStoryCodeIfChanged({
					baselineCode: baselineRef.current.code,
					code: snapshot.code,
					persist: async () => {
						if (!isSaveIdentityActive()) {
							return;
						}
						await saveTarget.persist({
							chatId: saveTarget.chatId,
							storySlug: saveTarget.storySlug,
							title: saveTarget.storyTitle,
							code: snapshot.code,
							action: 'replace',
						});
						if (!isSaveIdentityActive()) {
							return;
						}
					},
				});
				if (!isSaveIdentityActive()) {
					return 'unavailable';
				}

				if (result !== 'saved') {
					if (saved && result === 'unchanged') {
						if (!isSaveIdentityActive()) {
							return 'unavailable';
						}
						await saveTarget.refreshQueries();
						if (!isSaveIdentityActive()) {
							return 'unavailable';
						}

						const refreshedSnapshot = readCurrentCode(saveTarget.identity);
						if (typeof refreshedSnapshot === 'string') {
							return refreshedSnapshot;
						}
						if (!isSameStoryIdentity(baselineRef.current.identity, saveTarget.identity)) {
							return 'unavailable';
						}
						if (refreshedSnapshot.code !== baselineRef.current.code) {
							continue;
						}
						saveTarget.onVersionSaved?.(refreshedSnapshot.code);
						return 'saved';
					}
					return result;
				}

				baselineRef.current = { identity: saveTarget.identity, code: snapshot.code };
				saved = true;
			}
		};

		setIsSavingVersion(true);
		const promise = save().finally(() => {
			if (savePromiseRef.current?.promise !== promise) {
				return;
			}
			savePromiseRef.current = null;
			setIsSavingVersion(false);
		});
		savePromiseRef.current = { identity: saveIdentity, promise };
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

function isSameStoryIdentity(first: StoryIdentity, second: StoryIdentity): boolean {
	return first.chatId === second.chatId && first.storySlug === second.storySlug;
}
