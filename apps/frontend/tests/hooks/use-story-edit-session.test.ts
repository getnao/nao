// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react';
import { TRPCClientError } from '@trpc/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { deferred } from '../helpers/deferred';
import type { TrpcRouter } from '@nao/backend/trpc';
import { isStoryContentQueryKey, useStoryEditSession } from '@/hooks/use-story-edit-session';

type EditState = {
	latestVersion: number | null;
	latestAuthorName: string | null;
	lock: { holderName: string; isMine: boolean; isYou: boolean; byAgent: boolean } | null;
};
type MutationOptions = {
	onSuccess?: (result: unknown, variables: { storyId: string }) => void;
	onError?: (error: unknown, variables: { storyId: string }) => void;
};

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
			return { mutateAsync: mocks.acquire };
		}
		return { mutateAsync: mocks.release };
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
const ADA_EDITING = { holderName: 'Ada', isMine: false, isYou: false, byAgent: false };
const LOCK_RENEW_MS = 20_000;

describe('useStoryEditSession', () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.clearAllMocks();
		mocks.editState = { latestVersion: 1, latestAuthorName: 'Ada', lock: null };
	});

	afterEach(async () => {
		await flushLockRequests();
		vi.useRealTimers();
	});

	it('holds the lock for this tab while editing, renews it, and lets it go when editing stops', async () => {
		const { rerender } = renderHook((isEditing: boolean) => useStoryEditSession({ target: TARGET, isEditing }), {
			initialProps: true,
		});

		expect(mocks.acquire).toHaveBeenCalledOnce();
		const lockInput = mocks.acquire.mock.calls[0][0];
		expect(lockInput).toEqual({ storyId: 'story-1', sessionId: expect.any(String) });

		await act(() => vi.advanceTimersByTimeAsync(LOCK_RENEW_MS));
		expect(mocks.acquire).toHaveBeenCalledTimes(2);

		rerender(false);
		await flushLockRequests();
		expect(mocks.release).toHaveBeenCalledWith(lockInput);
	});

	it('releases the lock only once the acquire it follows is answered', async () => {
		const pendingAcquire = deferred<void>();
		mocks.acquire.mockReturnValueOnce(pendingAcquire.promise);
		const { rerender } = renderHook((isEditing: boolean) => useStoryEditSession({ target: TARGET, isEditing }), {
			initialProps: true,
		});

		rerender(false);
		await flushLockRequests();
		expect(mocks.release).not.toHaveBeenCalled();

		pendingAcquire.resolve();
		await flushLockRequests();
		expect(mocks.release).toHaveBeenCalledOnce();
	});

	it('stops asking for the lock once someone else holds it, until the person edits again', async () => {
		const { rerender } = renderHook((isEditing: boolean) => useStoryEditSession({ target: TARGET, isEditing }), {
			initialProps: true,
		});

		mocks.editState = { ...mocks.editState, lock: ADA_EDITING };
		act(() => {
			mocks.acquireOptions.onError?.(lockConflict(), { storyId: 'story-1' });
		});
		await act(() => vi.advanceTimersByTimeAsync(LOCK_RENEW_MS * 3));
		expect(mocks.acquire).toHaveBeenCalledOnce();
		expect(mocks.refetch).toHaveBeenCalled();

		rerender(false);
		rerender(true);
		await flushLockRequests();
		expect(mocks.acquire).toHaveBeenCalledTimes(2);
	});

	it('takes the lock back once the other editor lets go, and only then lets the person edit again', async () => {
		const { result, rerender } = renderHook(() => useStoryEditSession({ target: TARGET, isEditing: true }));
		mocks.editState = { ...mocks.editState, lock: ADA_EDITING };
		act(() => {
			mocks.acquireOptions.onError?.(lockConflict(), { storyId: 'story-1' });
		});

		mocks.editState = { ...mocks.editState, lock: null };
		rerender();
		await flushLockRequests();
		expect(mocks.acquire).toHaveBeenCalledTimes(2);
		expect(result.current.canEdit).toBe(false);

		const releasesBeforeRetryAnswered = mocks.release.mock.calls.length;
		mocks.editState = { ...mocks.editState, lock: { ...ADA_EDITING, holderName: 'Me', isMine: true } };
		rerender();
		act(() => {
			mocks.acquireOptions.onSuccess?.(undefined, { storyId: 'story-1' });
		});
		await flushLockRequests();
		expect(result.current.canEdit).toBe(true);
		expect(mocks.release).toHaveBeenCalledTimes(releasesBeforeRetryAnswered);
	});

	it('stops letting the person edit once the server refuses them the right to, until the edit is closed', () => {
		const { result, rerender } = renderHook(
			(isEditing: boolean) => useStoryEditSession({ target: TARGET, isEditing }),
			{ initialProps: true },
		);
		expect(result.current.canEdit).toBe(true);

		act(() => {
			mocks.acquireOptions.onError?.(lockRefusal('FORBIDDEN'), { storyId: 'story-1' });
		});
		expect(result.current).toMatchObject({ isLockedByOthers: false, canEdit: false });

		rerender(false);
		expect(result.current.canEdit).toBe(true);
	});

	it('does not let the person edit while someone else holds the lock', () => {
		mocks.editState = {
			latestVersion: 1,
			latestAuthorName: 'Ada',
			lock: { holderName: 'Ada', isMine: false, isYou: false, byAgent: false },
		};

		const { result } = renderHook(() => useStoryEditSession({ target: TARGET, isEditing: false }));

		expect(result.current.canEdit).toBe(false);
	});

	it('lets the lock lapse after a long idle spell, and takes it back on the next keystroke', async () => {
		renderHook(() => useStoryEditSession({ target: TARGET, isEditing: true }));

		await act(() => vi.advanceTimersByTimeAsync(10 * 60_000 + LOCK_RENEW_MS));
		const callsWhileIdle = mocks.acquire.mock.calls.length;
		await act(() => vi.advanceTimersByTimeAsync(LOCK_RENEW_MS));
		expect(mocks.acquire).toHaveBeenCalledTimes(callsWhileIdle);

		window.dispatchEvent(new KeyboardEvent('keydown'));
		await act(() => vi.advanceTimersByTimeAsync(LOCK_RENEW_MS));
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

async function flushLockRequests(): Promise<void> {
	await act(async () => {
		for (let tick = 0; tick < 10; tick++) {
			await Promise.resolve();
		}
	});
}

function lockConflict(): TRPCClientError<TrpcRouter> {
	return lockRefusal('CONFLICT');
}

function lockRefusal(code: 'CONFLICT' | 'FORBIDDEN'): TRPCClientError<TrpcRouter> {
	const error = new TRPCClientError<TrpcRouter>('You cannot edit this story.');
	Object.assign(error, { data: { code } });
	return error;
}
