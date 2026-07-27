// @vitest-environment jsdom

import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useStoryViewerVersions } from './use-story-viewer-versions';

const queryState = vi.hoisted(() => ({
	versions: [] as Array<{ code: string }>,
}));

vi.mock('@tanstack/react-query', () => ({
	useQuery: () => ({
		data: {
			id: 'story-id',
			title: 'Story',
			archivedAt: null,
			versions: queryState.versions,
		},
		refetch: vi.fn(),
	}),
	useQueryClient: () => ({
		invalidateQueries: vi.fn(),
	}),
}));

vi.mock('@/main', () => ({
	trpc: {
		story: {
			listVersions: {
				queryOptions: vi.fn(() => ({})),
			},
			listAll: {
				queryKey: vi.fn(() => ['story', 'listAll']),
			},
			getLatest: {
				queryKey: vi.fn(() => ['story', 'getLatest']),
			},
		},
	},
}));

describe('useStoryViewerVersions', () => {
	afterEach(() => {
		cleanup();
		queryState.versions = [];
		vi.clearAllMocks();
	});

	it('follows an appended latest version without a stale render', () => {
		queryState.versions = versions('one', 'two');
		const renders: Array<{ code: string | undefined; number: number; isLatest: boolean }> = [];
		const { rerender } = renderHook(() => {
			const result = useVersions();
			renders.push({
				code: result.currentVersion?.code,
				number: result.currentVersionNumber,
				isLatest: result.isViewingLatest,
			});
			return result;
		});
		const renderCountBeforeAppend = renders.length;

		queryState.versions = versions('one', 'two', 'three');
		rerender();

		const appendRenders = renders.slice(renderCountBeforeAppend);
		expect(appendRenders).toEqual([{ code: 'three', number: 3, isLatest: true }]);
	});

	it('preserves a historical version when a new version is appended', () => {
		queryState.versions = versions('one', 'two', 'three');
		const { result, rerender } = renderHook(() => useVersions());

		act(() => result.current.goToPreviousVersion());
		expect(result.current.currentVersion?.code).toBe('two');

		queryState.versions = versions('one', 'two', 'three', 'four');
		rerender();

		expect(result.current.currentVersion?.code).toBe('two');
		expect(result.current.currentVersionNumber).toBe(2);
		expect(result.current.isViewingLatest).toBe(false);
	});

	it('moves backward through history and returns to latest', () => {
		queryState.versions = versions('one', 'two', 'three');
		const { result } = renderHook(() => useVersions());

		act(() => result.current.goToPreviousVersion());
		expect(result.current.currentVersionNumber).toBe(2);
		expect(result.current.isViewingLatest).toBe(false);

		act(() => result.current.goToPreviousVersion());
		act(() => result.current.goToPreviousVersion());
		expect(result.current.currentVersionNumber).toBe(1);

		act(() => result.current.goToNextVersion());
		expect(result.current.currentVersionNumber).toBe(2);
		expect(result.current.isViewingLatest).toBe(false);

		act(() => result.current.goToNextVersion());
		expect(result.current.currentVersionNumber).toBe(3);
		expect(result.current.isViewingLatest).toBe(true);
	});
});

function useVersions() {
	return useStoryViewerVersions({
		chatId: 'chat-id',
		storySlug: 'story-slug',
		isAgentRunning: false,
	});
}

function versions(...codes: string[]) {
	return codes.map((code) => ({ code }));
}
