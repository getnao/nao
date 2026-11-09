// @vitest-environment jsdom

import { act, renderHook, waitFor } from '@testing-library/react';
import { TRPCClientError } from '@trpc/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useStoryViewerVersionActions } from './use-story-viewer-version-actions';
import type { StoryCodeViewHandle } from '../story-code-view';
import type { MutableRefObject } from 'react';
import type { TrpcRouter } from '@nao/backend/trpc';

interface CreateVersionInput {
	chatId: string;
	storySlug: string;
	title: string;
	code: string;
	action: 'replace';
	basedOnVersion?: number;
}

const SAVED_VERSION = { version: 2 };

const mocks = vi.hoisted(() => ({
	invalidateQueries: vi.fn(async () => {}),
	mutate: vi.fn(),
	mutateAsync: vi.fn(async (_input: CreateVersionInput) => ({ version: 2 })),
}));

vi.mock('@tanstack/react-query', () => ({
	useMutation: () => ({
		isPending: false,
		mutate: mocks.mutate,
		mutateAsync: mocks.mutateAsync,
	}),
	useQueryClient: () => ({
		invalidateQueries: mocks.invalidateQueries,
	}),
}));

vi.mock('@/main', () => ({
	trpc: {
		story: {
			createVersion: {
				mutationOptions: () => ({}),
			},
			getLatest: {
				queryKey: ({ chatId, storySlug }: { chatId: string; storySlug: string }) => [
					'latest',
					chatId,
					storySlug,
				],
			},
			listAll: {
				queryKey: () => ['all'],
			},
			listVersions: {
				queryKey: ({ chatId, storySlug }: { chatId: string; storySlug: string }) => [
					'versions',
					chatId,
					storySlug,
				],
			},
		},
	},
}));

interface HookProps {
	chatId: string;
	storySlug: string;
	storyTitle: string;
	persistedCode: string;
	currentCode: string;
	onVersionSaved: (code: string) => void;
}

const codeViewRef = { current: null } as MutableRefObject<StoryCodeViewHandle | null>;

describe('useStoryViewerVersionActions', () => {
	beforeEach(() => {
		mocks.invalidateQueries.mockReset();
		mocks.invalidateQueries.mockResolvedValue(undefined);
		mocks.mutate.mockClear();
		mocks.mutateAsync.mockReset();
		mocks.mutateAsync.mockResolvedValue(SAVED_VERSION);
	});

	it('does not let an old save continue into a newly rendered Story', async () => {
		const firstMutation = deferred<typeof SAVED_VERSION>();
		mocks.mutateAsync.mockImplementationOnce(() => firstMutation.promise);
		const onStoryASaved = vi.fn();
		const onStoryBSaved = vi.fn();
		const { result, rerender } = renderHook(
			(props: HookProps) =>
				useStoryViewerVersionActions({
					chatId: props.chatId,
					storySlug: props.storySlug,
					storyTitle: props.storyTitle,
					currentVersionCode: props.persistedCode,
					currentVersionNumber: 1,
					hasUnsavedChanges: false,
					isViewingLatest: true,
					goToLatestVersion: vi.fn(),
					codeViewRef,
					getCurrentCode: () => props.currentCode,
					viewMode: 'edit',
					setViewMode: vi.fn(),
					onVersionSaved: props.onVersionSaved,
				}),
			{
				initialProps: {
					chatId: 'chat-a',
					storySlug: 'story-a',
					storyTitle: 'Story A',
					persistedCode: '# Story A',
					currentCode: '# Story A edit',
					onVersionSaved: onStoryASaved,
				},
			},
		);

		let savePromise!: Promise<string>;
		act(() => {
			savePromise = result.current.saveCurrentVersion();
		});
		await waitFor(() => expect(mocks.mutateAsync).toHaveBeenCalledOnce());

		rerender({
			chatId: 'chat-b',
			storySlug: 'story-b',
			storyTitle: 'Story B',
			persistedCode: '# Story B',
			currentCode: '# Story B',
			onVersionSaved: onStoryBSaved,
		});

		await act(async () => {
			firstMutation.resolve(SAVED_VERSION);
			expect(await savePromise).toBe('unavailable');
		});

		expect(mocks.mutateAsync).toHaveBeenCalledTimes(1);
		expect(mocks.mutateAsync).toHaveBeenCalledWith({
			chatId: 'chat-a',
			storySlug: 'story-a',
			title: 'Story A',
			code: '# Story A edit',
			action: 'replace',
			basedOnVersion: 1,
		});
		expect(mocks.invalidateQueries).not.toHaveBeenCalled();
		expect(onStoryASaved).not.toHaveBeenCalled();
		expect(onStoryBSaved).not.toHaveBeenCalled();

		rerender({
			chatId: 'chat-b',
			storySlug: 'story-b',
			storyTitle: 'Story B',
			persistedCode: '# Story B',
			currentCode: '# Story B edit',
			onVersionSaved: onStoryBSaved,
		});

		await act(async () => {
			expect(await result.current.saveCurrentVersion()).toBe('saved');
		});

		expect(mocks.mutateAsync).toHaveBeenCalledTimes(2);
		expect(mocks.mutateAsync).toHaveBeenLastCalledWith({
			chatId: 'chat-b',
			storySlug: 'story-b',
			title: 'Story B',
			code: '# Story B edit',
			action: 'replace',
			basedOnVersion: 1,
		});
		expect(onStoryBSaved).toHaveBeenCalledOnce();
		expect(onStoryBSaved).toHaveBeenCalledWith('# Story B edit');
	});

	it('persists newer edits made to the same Story while saving', async () => {
		const firstMutation = deferred<typeof SAVED_VERSION>();
		const refresh = deferred<void>();
		mocks.mutateAsync.mockImplementationOnce(() => firstMutation.promise);
		mocks.invalidateQueries.mockImplementationOnce(() => refresh.promise);
		const onVersionSaved = vi.fn();
		const { result, rerender } = renderHook(
			(props: HookProps) =>
				useStoryViewerVersionActions({
					chatId: props.chatId,
					storySlug: props.storySlug,
					storyTitle: props.storyTitle,
					currentVersionCode: props.persistedCode,
					currentVersionNumber: 1,
					hasUnsavedChanges: false,
					isViewingLatest: true,
					goToLatestVersion: vi.fn(),
					codeViewRef,
					getCurrentCode: () => props.currentCode,
					viewMode: 'edit',
					setViewMode: vi.fn(),
					onVersionSaved: props.onVersionSaved,
				}),
			{
				initialProps: {
					chatId: 'chat-a',
					storySlug: 'story-a',
					storyTitle: 'Story A',
					persistedCode: '# Story A',
					currentCode: '# First edit',
					onVersionSaved,
				},
			},
		);

		let savePromise!: Promise<string>;
		act(() => {
			savePromise = result.current.saveCurrentVersion();
		});
		await waitFor(() => expect(mocks.mutateAsync).toHaveBeenCalledOnce());

		rerender({
			chatId: 'chat-a',
			storySlug: 'story-a',
			storyTitle: 'Story A',
			persistedCode: '# Story A',
			currentCode: '# Newer edit',
			onVersionSaved,
		});

		act(() => {
			firstMutation.resolve(SAVED_VERSION);
		});
		await waitFor(() => expect(mocks.mutateAsync).toHaveBeenCalledTimes(2));
		await waitFor(() => expect(mocks.invalidateQueries).toHaveBeenCalledTimes(3));

		expect(mocks.mutateAsync).toHaveBeenCalledTimes(2);
		expect(mocks.mutateAsync.mock.calls.map(([input]) => input.code)).toEqual(['# First edit', '# Newer edit']);
		expect(result.current.isSaving).toBe(true);
		expect(onVersionSaved).not.toHaveBeenCalled();

		await act(async () => {
			refresh.resolve();
			expect(await savePromise).toBe('saved');
		});

		expect(onVersionSaved).toHaveBeenCalledOnce();
		expect(onVersionSaved).toHaveBeenCalledWith('# Newer edit');
	});

	it('saves on top of the version being edited, then on top of the version it saved', async () => {
		mocks.mutateAsync.mockResolvedValueOnce({ version: 6 }).mockResolvedValueOnce({ version: 7 });
		const { result, rerender } = renderVersionedHook({ currentCode: '# First edit' });

		await act(async () => {
			expect(await result.current.saveCurrentVersion()).toBe('saved');
		});
		rerender({ currentCode: '# Second edit' });
		await act(async () => {
			expect(await result.current.saveCurrentVersion()).toBe('saved');
		});

		expect(mocks.mutateAsync.mock.calls.map(([input]) => input.basedOnVersion)).toEqual([5, 6]);
		expect(result.current.saveError).toBeNull();
	});

	it('keeps the version being edited when a refetch brings a newer one under unsaved edits', async () => {
		mocks.mutateAsync.mockResolvedValueOnce({ version: 7 });
		const { result, rerender } = renderVersionedHook({ currentCode: '# My edit', hasUnsavedChanges: true });

		rerender({
			currentCode: '# My edit',
			persistedCode: '# Someone else',
			versionNumber: 6,
			hasUnsavedChanges: true,
		});
		await act(async () => {
			await result.current.saveCurrentVersion();
		});

		expect(mocks.mutateAsync.mock.calls.map(([input]) => input.basedOnVersion)).toEqual([5]);
	});

	it('does not save before the version being edited is known', async () => {
		const { result } = renderVersionedHook({ currentCode: '# My edit', versionNumber: null });

		await act(async () => {
			expect(await result.current.saveCurrentVersion()).toBe('unavailable');
		});

		expect(mocks.mutateAsync).not.toHaveBeenCalled();
	});

	it('tells the user when someone saved a newer version meanwhile, instead of overwriting it', async () => {
		mocks.mutateAsync.mockRejectedValueOnce(
			TRPCClientError.from<TrpcRouter>({
				error: {
					code: -32009,
					message: 'Someone saved a newer version while you were editing.',
					data: { code: 'CONFLICT', httpStatus: 409 },
				},
			}),
		);
		const { result } = renderVersionedHook({ currentCode: '# My edit' });

		await act(async () => {
			expect(await result.current.saveCurrentVersion()).toBe('failed');
		});

		expect(result.current.saveError).toMatch(/newer version/);
	});
});

interface VersionedHookProps {
	currentCode: string;
	persistedCode?: string;
	versionNumber?: number | null;
	hasUnsavedChanges?: boolean;
}

function renderVersionedHook(initialProps: VersionedHookProps) {
	return renderHook(
		(props: VersionedHookProps) =>
			useStoryViewerVersionActions({
				chatId: 'chat-a',
				storySlug: 'story-a',
				storyTitle: 'Story A',
				currentVersionCode: props.persistedCode ?? '# Story A',
				currentVersionNumber: props.versionNumber === null ? undefined : (props.versionNumber ?? 5),
				hasUnsavedChanges: props.hasUnsavedChanges ?? false,
				isViewingLatest: true,
				goToLatestVersion: vi.fn(),
				codeViewRef,
				getCurrentCode: () => props.currentCode,
				viewMode: 'edit',
				setViewMode: vi.fn(),
			}),
		{ initialProps },
	);
}

function deferred<T>() {
	let resolve!: (value: T | PromiseLike<T>) => void;
	const promise = new Promise<T>((promiseResolve) => {
		resolve = promiseResolve;
	});
	return { promise, resolve };
}
