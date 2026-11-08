// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react';
import { TRPCClientError } from '@trpc/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isStoryContentQueryKey, useStoryEditSession } from './use-story-edit-session';
import type { TrpcRouter } from '@nao/backend/trpc';

type EditState = {
	latestVersion: number | null;
	latestAuthorName: string | null;
	lock: { holderName: string; isMine: boolean; isYou: boolean; byAgent: boolean } | null;
};
type MutationOptions = { onError?: (error: unknown, variables: { storyId: string }) => void };

const mocks = vi.hoisted(() => ({
	editState: { latestVersion: 1, latestAuthorName: 'Ada', lock: null } as EditState,
	refetch: vi.fn(),
	acquire: vi.fn(),
	release: vi.fn(),
	invalidateQueries: vi.fn(),
	acquireOptions: {} as MutationOptions,
}));

vi.mock('@tanstack/react-query', () => ({
	useQuery: () => ({ data: mocks.editState, refetch: mocks.refetch }),
	useMutation: (options: MutationOptions & { kind: string }) => {
		if (options.kind === 'acquire') {
			mocks.acquireOptions = options;
			return { mutate: mocks.acquire };
		}
		return { mutate: mocks.release };
	},
	useQueryClient: () => ({ invalidateQueries: mocks.invalidateQueries }),
}));
vi.mock('@/main', () => ({
	trpc: {
		story: {
			getEditState: { queryOptions: (input: unknown) => ({ input }) },
			acquireEditLock: { mutationOptions: (options: MutationOptions) => ({ ...options, kind: 'acquire' }) },
			releaseEditLock: { mutationOptions: () => ({ kind: 'release' }) },
		},
	},
}));
vi.mock('@/lib/auth-client', () => ({ useSession: () => ({ data: { user: { name: 'Me' } } }) }));

const TARGET = { storyId: 'story-1', chatId: 'chat-1', storySlug: 'revenue' };
const LOCK_RENEW_MS = 20_000;

describe('useStoryEditSession', () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.clearAllMocks();
		mocks.editState = { latestVersion: 1, latestAuthorName: 'Ada', lock: null };
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it('holds the lock for this tab while editing, renews it, and lets it go when editing stops', () => {
		const { rerender } = renderHook((isEditing: boolean) => useStoryEditSession({ target: TARGET, isEditing }), {
			initialProps: true,
		});

		expect(mocks.acquire).toHaveBeenCalledOnce();
		const lockInput = mocks.acquire.mock.calls[0][0];
		expect(lockInput).toEqual({ storyId: 'story-1', sessionId: expect.any(String) });

		act(() => {
			vi.advanceTimersByTime(LOCK_RENEW_MS);
		});
		expect(mocks.acquire).toHaveBeenCalledTimes(2);

		rerender(false);
		expect(mocks.release).toHaveBeenCalledWith(lockInput);
	});

	it('stops asking for the lock once someone else holds it, until the person edits again', () => {
		const { rerender } = renderHook((isEditing: boolean) => useStoryEditSession({ target: TARGET, isEditing }), {
			initialProps: true,
		});

		act(() => {
			mocks.acquireOptions.onError?.(lockConflict(), { storyId: 'story-1' });
		});
		act(() => {
			vi.advanceTimersByTime(LOCK_RENEW_MS * 3);
		});
		expect(mocks.acquire).toHaveBeenCalledOnce();
		expect(mocks.refetch).toHaveBeenCalled();

		rerender(false);
		rerender(true);
		expect(mocks.acquire).toHaveBeenCalledTimes(2);
	});

	it('lets the lock lapse after a long idle spell, and takes it back on the next keystroke', () => {
		renderHook(() => useStoryEditSession({ target: TARGET, isEditing: true }));

		act(() => {
			vi.advanceTimersByTime(10 * 60_000 + LOCK_RENEW_MS);
		});
		const callsWhileIdle = mocks.acquire.mock.calls.length;
		act(() => {
			vi.advanceTimersByTime(LOCK_RENEW_MS);
		});
		expect(mocks.acquire).toHaveBeenCalledTimes(callsWhileIdle);

		act(() => {
			window.dispatchEvent(new KeyboardEvent('keydown'));
			vi.advanceTimersByTime(LOCK_RENEW_MS);
		});
		expect(mocks.acquire).toHaveBeenCalledTimes(callsWhileIdle + 1);
	});

	it('waits for the edit to end before reloading a version someone else saved', () => {
		const { rerender } = renderHook((isEditing: boolean) => useStoryEditSession({ target: TARGET, isEditing }), {
			initialProps: true,
		});

		mocks.editState = { latestVersion: 2, latestAuthorName: 'Ada', lock: null };
		rerender(true);
		expect(mocks.invalidateQueries).not.toHaveBeenCalled();

		rerender(false);
		expect(mocks.invalidateQueries).toHaveBeenCalledOnce();
	});

	it('tells the viewer they are editing the story in another tab', () => {
		mocks.editState = {
			latestVersion: 1,
			latestAuthorName: 'Ada',
			lock: { holderName: 'Me', isMine: false, isYou: true, byAgent: false },
		};

		const { result } = renderHook(() => useStoryEditSession({ target: TARGET, isEditing: false }));

		expect(result.current).toMatchObject({
			isLockedByOthers: true,
			otherEditorName: null,
			ownEditElsewhere: 'tab',
		});
	});
});

describe('isStoryContentQueryKey', () => {
	it('matches the queries of the story, by id or by chat and slug', () => {
		expect(
			isStoryContentQueryKey([['storyShare', 'get'], { input: { storyId: 'story-1' }, type: 'query' }], TARGET),
		).toBe(true);
		expect(
			isStoryContentQueryKey(
				[['story', 'getLatest'], { input: { chatId: 'chat-1', storySlug: 'revenue' }, type: 'query' }],
				TARGET,
			),
		).toBe(true);
	});

	it('leaves out other stories, other routers and the edit state itself', () => {
		expect(
			isStoryContentQueryKey(
				[['story', 'getLatest'], { input: { chatId: 'chat-1', storySlug: 'costs' }, type: 'query' }],
				TARGET,
			),
		).toBe(false);
		expect(
			isStoryContentQueryKey([['chat', 'get'], { input: { storyId: 'story-1' }, type: 'query' }], TARGET),
		).toBe(false);
		expect(
			isStoryContentQueryKey(
				[['story', 'getEditState'], { input: { storyId: 'story-1' }, type: 'query' }],
				TARGET,
			),
		).toBe(false);
	});
});

function lockConflict(): TRPCClientError<TrpcRouter> {
	const error = new TRPCClientError<TrpcRouter>('Ada is editing this story.');
	Object.assign(error, { data: { code: 'CONFLICT' } });
	return error;
}
