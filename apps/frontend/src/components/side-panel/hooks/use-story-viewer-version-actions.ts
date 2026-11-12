import { useCallback, useEffect, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { MutableRefObject } from 'react';
import type { StoryViewMode } from '../story-viewer.types';
import type { StoryCodeViewHandle } from '../story-code-view';
import type { StorySaveResult } from '@/lib/story-save';
import { isStoryVersionConflict, saveStoryCodeIfChanged } from '@/lib/story-save';
import { trpc } from '@/main';

interface UseStoryViewerVersionActionsParams {
	chatId: string;
	storySlug: string;
	storyTitle?: string;
	currentVersionCode?: string;
	currentVersionNumber?: number;
	latestVersionNumber?: number;
	hasUnsavedChanges: boolean;
	isViewingLatest: boolean;
	goToLatestVersion: () => void;
	codeViewRef: MutableRefObject<StoryCodeViewHandle | null>;
	getCurrentCode: () => string;
	viewMode: StoryViewMode;
	setViewMode: (mode: StoryViewMode) => void;
	onVersionSaved?: (code: string) => void;
	/** A story outside any chat saves its versions by its id. */
	standaloneStoryId?: string;
}

interface StoryVersionDraft {
	title: string;
	code: string;
	basedOnVersion: number;
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
	currentVersionNumber,
	latestVersionNumber,
	hasUnsavedChanges,
	isViewingLatest,
	goToLatestVersion,
	codeViewRef,
	getCurrentCode,
	viewMode,
	setViewMode,
	onVersionSaved,
	standaloneStoryId,
}: UseStoryViewerVersionActionsParams) => {
	const queryClient = useQueryClient();
	const identity = { chatId, storySlug };
	const currentIdentityRef = useRef(identity);
	const baselineRef = useRef({ identity, code: currentVersionCode, version: currentVersionNumber });
	const [saveError, setSaveError] = useState<string | null>(null);
	const savePromiseRef = useRef<{ identity: StoryIdentity; promise: Promise<StorySaveResult> } | null>(null);
	const [isSavingVersion, setIsSavingVersion] = useState(false);
	const paramsRef = useRef({
		identity,
		storyTitle,
		currentVersionCode,
		getCurrentCode,
		viewMode,
		onVersionSaved,
	});

	currentIdentityRef.current = identity;
	if (!isSameStoryIdentity(baselineRef.current.identity, identity)) {
		baselineRef.current = { identity, code: currentVersionCode, version: currentVersionNumber };
	}
	paramsRef.current = {
		identity,
		storyTitle,
		currentVersionCode,
		getCurrentCode,
		viewMode,
		onVersionSaved,
	};

	const { mutateAsync: createVersion, isPending: isCreatingVersion } = useMutation(
		trpc.story.createVersion.mutationOptions(),
	);
	const { mutateAsync: createStandaloneVersion, isPending: isCreatingStandaloneVersion } = useMutation(
		trpc.story.createStandaloneVersion.mutationOptions(),
	);
	const persistVersion = useCallback(
		(draft: StoryVersionDraft) =>
			standaloneStoryId
				? createStandaloneVersion({
						storyId: standaloneStoryId,
						code: draft.code,
						basedOnVersion: draft.basedOnVersion,
					})
				: createVersion({ chatId, storySlug, ...draft, action: 'replace' }),
		[chatId, createStandaloneVersion, createVersion, standaloneStoryId, storySlug],
	);
	const persistVersionRef = useRef(persistVersion);
	persistVersionRef.current = persistVersion;
	const isPersistingVersion = isCreatingVersion || isCreatingStandaloneVersion;
	const refreshQueries = useCallback(async () => {
		const queryKeys = standaloneStoryId
			? [
					trpc.story.listStandaloneVersions.queryKey({ storyId: standaloneStoryId }),
					trpc.story.listStandalone.queryKey(),
					trpc.story.getStandalone.queryKey({ storyId: standaloneStoryId }),
				]
			: [
					trpc.story.listVersions.queryKey({ chatId, storySlug }),
					trpc.story.listAll.queryKey(),
					trpc.story.getLatest.queryKey({ chatId, storySlug }),
				];
		await Promise.all(queryKeys.map((queryKey) => queryClient.invalidateQueries({ queryKey })));
	}, [chatId, queryClient, standaloneStoryId, storySlug]);
	const refreshQueriesRef = useRef(refreshQueries);
	refreshQueriesRef.current = refreshQueries;

	useEffect(() => {
		const activeSave = savePromiseRef.current;
		const hasActiveSaveForStory =
			activeSave !== null && isSameStoryIdentity(activeSave.identity, { chatId, storySlug });
		if (currentVersionCode === undefined || hasActiveSaveForStory) {
			return;
		}
		const storyIdentity = { chatId, storySlug };
		if (!hasUnsavedChanges) {
			baselineRef.current = { identity: storyIdentity, code: currentVersionCode, version: currentVersionNumber };
			return;
		}
		if (isLateVersionOfEditedCode(baselineRef.current, storyIdentity, currentVersionCode)) {
			baselineRef.current = { ...baselineRef.current, version: currentVersionNumber };
		}
	}, [chatId, currentVersionCode, currentVersionNumber, hasUnsavedChanges, storySlug]);

	useEffect(() => {
		setSaveError(null);
	}, [chatId, storySlug]);

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
			storyTitle: params.storyTitle,
			onVersionSaved: params.onVersionSaved,
			persist: persistVersionRef.current,
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
				if (
					!isSameStoryIdentity(baselineRef.current.identity, saveTarget.identity) ||
					baselineRef.current.version === undefined
				) {
					return 'unavailable';
				}

				let savedVersion = baselineRef.current.version;
				const result = await saveStoryCodeIfChanged({
					baselineCode: baselineRef.current.code,
					code: snapshot.code,
					persist: async () => {
						if (!isSaveIdentityActive()) {
							return;
						}
						try {
							const created = await saveTarget.persist({
								title: saveTarget.storyTitle,
								code: snapshot.code,
								basedOnVersion: savedVersion,
							});
							savedVersion = created.version;
							setSaveError(null);
						} catch (error) {
							if (isStoryVersionConflict(error)) {
								setSaveError((error as Error).message);
							}
							throw error;
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

				baselineRef.current = { identity: saveTarget.identity, code: snapshot.code, version: savedVersion };
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
		const hasVersionData =
			storyTitle !== undefined && currentVersionCode !== undefined && latestVersionNumber !== undefined;
		if (!hasVersionData || isViewingLatest || isPersistingVersion) {
			return;
		}

		persistVersion({ title: storyTitle, code: currentVersionCode, basedOnVersion: latestVersionNumber }).then(
			async () => {
				setSaveError(null);
				await refreshQueries();
				goToLatestVersion();
			},
			(error: Error) => {
				setSaveError(error.message);
			},
		);
	}, [
		storyTitle,
		currentVersionCode,
		latestVersionNumber,
		isViewingLatest,
		isPersistingVersion,
		persistVersion,
		refreshQueries,
		goToLatestVersion,
	]);

	return {
		handleSave,
		saveCurrentVersion,
		handleRestore,
		isSaving: isPersistingVersion || isSavingVersion,
		saveError,
	};
};

/** Edits may start before the version list loads; its number still applies when it describes the code being edited. */
function isLateVersionOfEditedCode(
	baseline: { identity: StoryIdentity; code: string | undefined; version: number | undefined },
	identity: StoryIdentity,
	currentVersionCode: string,
): boolean {
	return (
		baseline.version === undefined &&
		isSameStoryIdentity(baseline.identity, identity) &&
		baseline.code === currentVersionCode
	);
}

function isSameStoryIdentity(first: StoryIdentity, second: StoryIdentity): boolean {
	return first.chatId === second.chatId && first.storySlug === second.storySlug;
}
