// @vitest-environment jsdom

import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { deferred } from '../../../helpers/deferred';
import type { StoryCodeViewHandle } from '@/components/side-panel/story-code-view';
import type { MutableRefObject } from 'react';
import { useStoryViewerVersionActions } from '@/components/side-panel/hooks/use-story-viewer-version-actions';

interface CreateVersionInput {
	chatId: string;
	storySlug: string;
	title: string;
	code: string;
	action: 'replace';
}

const mocks = vi.hoisted(() => ({
	invalidateQueries: vi.fn(async () => {}),
	mutate: vi.fn(),
	mutateAsync: vi.fn(async (_input: CreateVersionInput) => {}),
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
const storyA = { chatId: 'chat-a', storySlug: 'story-a', storyTitle: 'Story A', persistedCode: '# Story A' };
const storyB = { chatId: 'chat-b', storySlug: 'story-b', storyTitle: 'Story B', persistedCode: '# Story B' };

describe('useStoryViewerVersionActions', () => {
	beforeEach(() => {
		mocks.invalidateQueries.mockReset();
		mocks.invalidateQueries.mockResolvedValue(undefined);
		mocks.mutate.mockClear();
		mocks.mutateAsync.mockReset();
		mocks.mutateAsync.mockResolvedValue(undefined);
	});

	it('does not let an old save continue into a newly rendered Story', async () => {
		const firstMutation = deferred<void>();
		mocks.mutateAsync.mockImplementationOnce(() => firstMutation.promise);
		const onStoryASaved = vi.fn();
		const onStoryBSaved = vi.fn();
		const { result, rerender } = renderVersionActions({
			...storyA,
			currentCode: '# Story A edit',
			onVersionSaved: onStoryASaved,
		});

		let savePromise!: Promise<string>;
		act(() => {
			savePromise = result.current.saveCurrentVersion();
		});
		await waitFor(() => expect(mocks.mutateAsync).toHaveBeenCalledOnce());

		rerender({ ...storyB, currentCode: '# Story B', onVersionSaved: onStoryBSaved });

		await act(async () => {
			firstMutation.resolve();
			expect(await savePromise).toBe('unavailable');
		});

		expect(mocks.mutateAsync).toHaveBeenCalledTimes(1);
		expect(mocks.mutateAsync).toHaveBeenCalledWith({
			chatId: 'chat-a',
			storySlug: 'story-a',
			title: 'Story A',
			code: '# Story A edit',
			action: 'replace',
		});
		expect(mocks.invalidateQueries).not.toHaveBeenCalled();
		expect(onStoryASaved).not.toHaveBeenCalled();
		expect(onStoryBSaved).not.toHaveBeenCalled();

		rerender({ ...storyB, currentCode: '# Story B edit', onVersionSaved: onStoryBSaved });

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
		});
		expect(onStoryBSaved).toHaveBeenCalledOnce();
		expect(onStoryBSaved).toHaveBeenCalledWith('# Story B edit');
	});

	it('persists newer edits made to the same Story while saving', async () => {
		const firstMutation = deferred<void>();
		const refresh = deferred<void>();
		mocks.mutateAsync.mockImplementationOnce(() => firstMutation.promise);
		mocks.invalidateQueries.mockImplementationOnce(() => refresh.promise);
		const onVersionSaved = vi.fn();
		const { result, rerender } = renderVersionActions({ ...storyA, currentCode: '# First edit', onVersionSaved });

		let savePromise!: Promise<string>;
		act(() => {
			savePromise = result.current.saveCurrentVersion();
		});
		await waitFor(() => expect(mocks.mutateAsync).toHaveBeenCalledOnce());

		rerender({ ...storyA, currentCode: '# Newer edit', onVersionSaved });

		act(() => {
			firstMutation.resolve();
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
});

function renderVersionActions(initialProps: HookProps) {
	return renderHook(
		(props: HookProps) =>
			useStoryViewerVersionActions({
				chatId: props.chatId,
				storySlug: props.storySlug,
				storyTitle: props.storyTitle,
				currentVersionCode: props.persistedCode,
				isViewingLatest: true,
				goToLatestVersion: vi.fn(),
				codeViewRef,
				getCurrentCode: () => props.currentCode,
				viewMode: 'edit',
				setViewMode: vi.fn(),
				onVersionSaved: props.onVersionSaved,
			}),
		{ initialProps },
	);
}
