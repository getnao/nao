// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useStoryStateRecorder, viewerStateOf } from './use-story-state-recorder';
import type { StoryStateSnapshot } from '@nao/shared/story-app';
import type { ReactNode } from 'react';

const STATE_KEY = ['story-state'];
const { saveLater, writerErrorRef } = vi.hoisted(() => ({
	saveLater: vi.fn(),
	writerErrorRef: { current: (_message: string) => {} },
}));

vi.mock('./story-data-options', () => ({ stateOptions: () => ({ queryKey: STATE_KEY }) }));
vi.mock('./use-story-state-writer', () => ({
	useStoryStateWriter: (_dataSource: unknown, reportError: (message: string) => void) => {
		writerErrorRef.current = reportError;
		return saveLater;
	},
}));

const DATA_SOURCE = { kind: 'share', storyId: 'story-1' } as const;
const MEMBER: StoryStateSnapshot = { shared: { tab: 'revenue', zoom: 1 }, own: { zoom: 3 }, isOwner: false };
const OWNER: StoryStateSnapshot = { shared: { tab: 'revenue' }, own: {}, isOwner: true };

function setup(snapshot: StoryStateSnapshot) {
	const queryClient = new QueryClient();
	queryClient.setQueryData(STATE_KEY, snapshot);
	const wrapper = ({ children }: { children: ReactNode }) => (
		<QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
	);
	const reportError = vi.fn();
	const { result } = renderHook(() => useStoryStateRecorder(DATA_SOURCE, reportError), { wrapper });
	const cached = () => queryClient.getQueryData<StoryStateSnapshot>(STATE_KEY);
	const isStale = () => queryClient.getQueryState(STATE_KEY)?.isInvalidated ?? false;
	return { record: result.current, cached, isStale, reportError };
}

describe('useStoryStateRecorder', () => {
	beforeEach(() => saveLater.mockReset());

	it("saves the owner's change into the view everyone starts from", () => {
		const { record, cached } = setup(OWNER);

		act(() => record({ key: 'tab', value: 'orders' }));

		expect(saveLater).toHaveBeenCalledWith({ key: 'tab', value: 'orders' });
		expect(cached()?.shared).toEqual({ tab: 'orders' });
	});

	it("saves a member's change into their own view only", () => {
		const { record, cached } = setup(MEMBER);

		act(() => record({ key: 'tab', value: 'orders' }));

		expect(cached()?.own).toEqual({ zoom: 3, tab: 'orders' });
		expect(cached()?.shared).toEqual(MEMBER.shared);
	});

	it("brings back the owner's value when a member removes theirs", () => {
		const { record, cached } = setup(MEMBER);

		act(() => record({ key: 'zoom', value: null }));

		expect(viewerStateOf(cached())).toEqual({ tab: 'revenue', zoom: 1 });
	});

	it('reports a failed save and stops trusting the cached value', () => {
		const { record, isStale, reportError } = setup(OWNER);
		act(() => record({ key: 'tab', value: 'orders' }));

		act(() => writerErrorRef.current('The story state "tab" could not be saved.'));

		expect(reportError).toHaveBeenCalledWith('The story state "tab" could not be saved.');
		expect(isStale()).toBe(true);
	});
});
