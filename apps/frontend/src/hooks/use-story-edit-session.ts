import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { TRPCClientError } from '@trpc/client';

import { useSession } from '@/lib/auth-client';
import { trpc } from '@/main';

const EDIT_STATE_POLL_MS = 5_000;
const LOCK_RENEW_MS = 20_000;
const EDIT_IDLE_MS = 10 * 60_000;
const UPDATE_NOTICE_MS = 6_000;
const STORY_ROUTERS = new Set(['story', 'storyShare', 'standaloneCustomStory']);
const EDIT_STATE_PROCEDURE = 'getEditState';
const USER_ACTIVITY_EVENTS = ['keydown', 'pointerdown', 'wheel'] as const;
const LOCK_REFUSAL_CODES = new Set(['CONFLICT', 'FORBIDDEN']);

/** Tells this browser tab apart from the other tabs of the same person. */
const EDIT_SESSION_ID = crypto.randomUUID();

let pendingLockRequest: Promise<void> | null = null;

export interface StoryQueryTarget {
	storyId: string;
	chatId?: string;
	storySlug?: string;
}

export interface StoryEditPresence {
	otherEditorName: string | null;
	ownEditElsewhere: 'chat' | 'tab' | null;
	isLockedByOthers: boolean;
	/** False while someone else holds the lock, or once the server refuses this person the right to edit. */
	canEdit: boolean;
	updatedByName: string | null;
}

/**
 * Keeps the story in sync with the people editing it: holds the edit lock while `isEditing`,
 * tells who else is editing, and reloads the content when someone else saves a version.
 * The lock is let go after a long idle spell so a forgotten tab never blocks everyone.
 */
export function useStoryEditSession({
	target,
	isEditing,
}: {
	target: StoryQueryTarget | null;
	isEditing: boolean;
}): StoryEditPresence {
	const storyId = target?.storyId ?? null;
	const editState = useQuery({
		...trpc.story.getEditState.queryOptions({ storyId: storyId ?? '', sessionId: EDIT_SESSION_ID }),
		enabled: storyId !== null,
		refetchInterval: EDIT_STATE_POLL_MS,
		refetchIntervalInBackground: false,
	});
	const refetchEditState = editState.refetch;
	const isEditForbidden = useHeldEditLock(storyId, isEditing, () => {
		void refetchEditState();
	});
	const updatedByName = useReloadOnNewVersion(target, editState.data, isEditing);

	const lock = editState.data?.lock ?? null;
	const isLockedByOthers = lock !== null && !lock.isMine;
	return {
		otherEditorName: isLockedByOthers && !lock.isYou ? lock.holderName : null,
		ownEditElsewhere: isLockedByOthers && lock.isYou ? (lock.byAgent ? 'chat' : 'tab') : null,
		isLockedByOthers,
		canEdit: !isLockedByOthers && !isEditForbidden,
		updatedByName,
	};
}

/** Holds the lock while editing; returns whether the server refused this person the right to edit the story. */
function useHeldEditLock(storyId: string | null, isEditing: boolean, onRefused: () => void): boolean {
	const [refusedStoryId, setRefusedStoryId] = useState<string | null>(null);
	const [forbiddenStoryId, setForbiddenStoryId] = useState<string | null>(null);
	const isRefused = storyId !== null && refusedStoryId === storyId;
	const lastActivityRef = useLastUserActivity();
	const acquire = useMutation(
		trpc.story.acquireEditLock.mutationOptions({
			onError: (error, variables) => {
				if (isLockRefusal(error)) {
					setRefusedStoryId(variables.storyId);
				}
				if (isEditForbiddenError(error)) {
					setForbiddenStoryId(variables.storyId);
				}
				onRefused();
			},
		}),
	);
	const release = useMutation(trpc.story.releaseEditLock.mutationOptions());
	const acquireRef = useRef(acquire.mutateAsync);
	const releaseRef = useRef(release.mutateAsync);
	acquireRef.current = acquire.mutateAsync;
	releaseRef.current = release.mutateAsync;

	useEffect(() => {
		if (!isEditing) {
			setRefusedStoryId(null);
		}
	}, [isEditing]);

	useEffect(() => {
		if (!storyId || !isEditing || isRefused) {
			return;
		}
		const lockInput = { storyId, sessionId: EDIT_SESSION_ID };
		sendLockRequestInOrder(() => acquireRef.current(lockInput));
		const renewal = window.setInterval(() => {
			if (Date.now() - lastActivityRef.current < EDIT_IDLE_MS) {
				sendLockRequestInOrder(() => acquireRef.current(lockInput));
			}
		}, LOCK_RENEW_MS);
		return () => {
			window.clearInterval(renewal);
			sendLockRequestInOrder(() => releaseRef.current(lockInput));
		};
	}, [storyId, isEditing, isRefused, lastActivityRef]);

	return storyId !== null && forbiddenStoryId === storyId;
}

function sendLockRequestInOrder(request: () => Promise<unknown>): void {
	const send = () => Promise.resolve(request()).then(ignore, ignore);
	const next = pendingLockRequest ? pendingLockRequest.then(send) : send();
	pendingLockRequest = next;
	void next.finally(() => {
		if (pendingLockRequest === next) {
			pendingLockRequest = null;
		}
	});
}

function ignore(): void {}

function useLastUserActivity() {
	const lastActivityRef = useRef(Date.now());
	useEffect(() => {
		const markActive = () => {
			lastActivityRef.current = Date.now();
		};
		for (const eventName of USER_ACTIVITY_EVENTS) {
			window.addEventListener(eventName, markActive, { passive: true });
		}
		return () => {
			for (const eventName of USER_ACTIVITY_EVENTS) {
				window.removeEventListener(eventName, markActive);
			}
		};
	}, []);
	return lastActivityRef;
}

function useReloadOnNewVersion(
	target: StoryQueryTarget | null,
	editState: { latestVersion: number | null; latestAuthorName: string | null } | undefined,
	isEditing: boolean,
): string | null {
	const queryClient = useQueryClient();
	const { data: session } = useSession();
	const seenVersionRef = useRef<number | null>(null);
	const [updatedByName, setUpdatedByName] = useState<string | null>(null);
	const latestVersion = editState?.latestVersion ?? null;
	const latestAuthorName = editState?.latestAuthorName ?? null;
	const viewerName = session?.user.name ?? null;

	useEffect(() => {
		if (latestVersion === null) {
			return;
		}
		const seenVersion = seenVersionRef.current;
		if (seenVersion === null) {
			seenVersionRef.current = latestVersion;
			return;
		}
		if (!target || isEditing || latestVersion <= seenVersion) {
			return;
		}
		seenVersionRef.current = latestVersion;
		void queryClient.invalidateQueries({ predicate: (query) => isStoryContentQueryKey(query.queryKey, target) });
		if (latestAuthorName && latestAuthorName !== viewerName) {
			setUpdatedByName(latestAuthorName);
		}
	}, [isEditing, latestAuthorName, latestVersion, queryClient, target, viewerName]);

	useEffect(() => {
		if (!updatedByName) {
			return;
		}
		const timeout = window.setTimeout(() => {
			setUpdatedByName(null);
		}, UPDATE_NOTICE_MS);
		return () => {
			window.clearTimeout(timeout);
		};
	}, [updatedByName]);

	return updatedByName;
}

/** True for the tRPC queries that read the content of the story `target`, whether by its id or by its chat and slug. */
export function isStoryContentQueryKey(queryKey: readonly unknown[], target: StoryQueryTarget): boolean {
	const [path, meta] = queryKey;
	if (!Array.isArray(path) || !STORY_ROUTERS.has(path[0]) || path[1] === EDIT_STATE_PROCEDURE) {
		return false;
	}
	const input = (meta as { input?: Record<string, unknown> } | undefined)?.input;
	if (!input) {
		return false;
	}
	if (input.storyId === target.storyId) {
		return true;
	}
	return target.chatId !== undefined && input.chatId === target.chatId && input.storySlug === target.storySlug;
}

function isLockRefusal(error: unknown): boolean {
	return error instanceof TRPCClientError && LOCK_REFUSAL_CODES.has(error.data?.code);
}

function isEditForbiddenError(error: unknown): boolean {
	return error instanceof TRPCClientError && error.data?.code === 'FORBIDDEN';
}

/** Closes whatever is being edited as soon as the story can no longer be edited here. */
export function useCloseWhenUneditable(canEdit: boolean, close: () => void): void {
	const closeRef = useRef(close);
	closeRef.current = close;
	useEffect(() => {
		if (!canEdit) {
			closeRef.current();
		}
	}, [canEdit]);
}
