import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useState } from 'react';
import { saveStoryState, stateOptions } from './story-data-options';
import { useStoryStateWriter } from './use-story-state-writer';
import type { StoryStateChange, StoryStateSnapshot, StoryStateValues } from '@nao/shared/story-app';

import type { CustomStoryDataSource } from './story-data-options';

/** `mine` is what the viewer saves; `shared` is the owner's saved view, which other viewers can only look at. */
export type StoryStateView = 'mine' | 'shared';

export interface StoryStateSession {
	snapshot: StoryStateSnapshot | undefined;
	view: StoryStateView;
	autoSave: boolean;
	hasChanges: boolean;
	isSaving: boolean;
	error: string | null;
	record: (change: StoryStateChange) => void;
	setView: (view: StoryStateView) => void;
	setAutoSave: (autoSave: boolean) => void;
	save: () => Promise<void>;
	discard: () => void;
}

interface StoryStateSessionOptions {
	dataSource: CustomStoryDataSource;
	storyId: string;
	autoSaveDefault: boolean;
	pushToFrame: (values: StoryStateValues) => void;
}

export function useStoryStateSession({
	dataSource,
	storyId,
	autoSaveDefault,
	pushToFrame,
}: StoryStateSessionOptions): StoryStateSession {
	const queryClient = useQueryClient();
	const { data: snapshot } = useQuery(stateOptions(dataSource));
	const saveLater = useStoryStateWriter(dataSource);
	const [view, setViewState] = useState<StoryStateView>('mine');
	const [autoSave, setAutoSaveState] = useState(() => readAutoSavePreference(storyId) ?? autoSaveDefault);
	const [draft, setDraft] = useState<StoryStateValues>({});
	const [isSaving, setIsSaving] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const isViewingShared = view === 'shared' && snapshot?.isOwner === false;

	const applyToCache = useCallback(
		(changes: StoryStateValues) => {
			queryClient.setQueryData<StoryStateSnapshot>(stateOptions(dataSource).queryKey, (current) => {
				if (!current) {
					return current;
				}
				return current.isOwner
					? { ...current, shared: applyChanges(current.shared, changes) }
					: { ...current, own: applyChanges(current.own, changes) };
			});
		},
		[dataSource, queryClient],
	);

	const save = useCallback(async () => {
		setIsSaving(true);
		try {
			for (const [key, value] of Object.entries(draft)) {
				await saveStoryState(dataSource, { key, value });
			}
			applyToCache(draft);
			setDraft({});
			setError(null);
		} catch (saveError) {
			setError(saveError instanceof Error ? saveError.message : 'The story view could not be saved.');
		} finally {
			setIsSaving(false);
		}
	}, [applyToCache, dataSource, draft]);

	const record = useCallback(
		(change: StoryStateChange) => {
			if (isViewingShared) {
				return;
			}
			if (autoSave) {
				applyToCache({ [change.key]: change.value });
				saveLater(change);
				return;
			}
			setDraft((current) => {
				const next = { ...current };
				if (isSameValue(savedViewOf(snapshot, 'mine')[change.key], change.value)) {
					delete next[change.key];
				} else {
					next[change.key] = change.value;
				}
				return next;
			});
		},
		[applyToCache, autoSave, isViewingShared, saveLater, snapshot],
	);

	const discard = useCallback(() => {
		pushToFrame(savedViewOf(snapshot, view));
		setDraft({});
		setError(null);
	}, [pushToFrame, snapshot, view]);

	const setView = useCallback(
		(next: StoryStateView) => {
			setViewState(next);
			pushToFrame(
				next === 'shared'
					? savedViewOf(snapshot, 'shared')
					: applyChanges(savedViewOf(snapshot, 'mine'), draft),
			);
		},
		[draft, pushToFrame, snapshot],
	);

	const setAutoSave = useCallback(
		(next: boolean) => {
			setAutoSaveState(next);
			writeAutoSavePreference(storyId, next);
			if (next) {
				void save();
			}
		},
		[save, storyId],
	);

	return {
		snapshot,
		view,
		autoSave,
		hasChanges: Object.keys(draft).length > 0,
		isSaving,
		error,
		record,
		setView,
		setAutoSave,
		save,
		discard,
	};
}

/** Another viewer's own view starts from the owner's saved view and overrides the keys they changed. */
export function savedViewOf(snapshot: StoryStateSnapshot | undefined, view: StoryStateView): StoryStateValues {
	if (!snapshot) {
		return {};
	}
	return view === 'shared' || snapshot.isOwner ? snapshot.shared : { ...snapshot.shared, ...snapshot.own };
}

function applyChanges(values: StoryStateValues, changes: StoryStateValues): StoryStateValues {
	const next = { ...values };
	for (const [key, value] of Object.entries(changes)) {
		if (value === null) {
			delete next[key];
		} else {
			next[key] = value;
		}
	}
	return next;
}

function isSameValue(saved: unknown, value: unknown): boolean {
	return JSON.stringify(saved ?? null) === JSON.stringify(value ?? null);
}

function readAutoSavePreference(storyId: string): boolean | null {
	try {
		const stored = localStorage.getItem(autoSaveStorageKey(storyId));
		return stored === null ? null : stored === 'true';
	} catch {
		return null;
	}
}

function writeAutoSavePreference(storyId: string, autoSave: boolean): void {
	try {
		localStorage.setItem(autoSaveStorageKey(storyId), String(autoSave));
	} catch {
		return;
	}
}

function autoSaveStorageKey(storyId: string): string {
	return `nao:story-auto-save:${storyId}`;
}
