// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useStoryStateRecorder } from './use-story-state-recorder';
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
const SNAPSHOT: StoryStateSnapshot = { shared: { round: 2 }, own: { zoom: 3 } };

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

	it("saves a personal change into the viewer's own state only", () => {
		const { record, cached } = setup(SNAPSHOT);

		act(() => record({ key: 'tab', value: 'orders', shared: false }));

		expect(saveLater).toHaveBeenCalledWith({ key: 'tab', value: 'orders', shared: false });
		expect(cached()).toEqual({ shared: { round: 2 }, own: { zoom: 3, tab: 'orders' } });
	});

	it('saves a shared change into the state every viewer sees', () => {
		const { record, cached } = setup(SNAPSHOT);

		act(() => record({ key: 'round', value: 3, shared: true }));

		expect(cached()).toEqual({ shared: { round: 3 }, own: { zoom: 3 } });
	});

	it('removes a key on null', () => {
		const { record, cached } = setup(SNAPSHOT);

		act(() => record({ key: 'zoom', value: null, shared: false }));

		expect(cached()?.own).toEqual({});
	});

	it('reports a failed save and stops trusting the cached value', () => {
		const { record, isStale, reportError } = setup(SNAPSHOT);
		act(() => record({ key: 'tab', value: 'orders', shared: false }));

		act(() => writerErrorRef.current('The story state "tab" could not be saved.'));

		expect(reportError).toHaveBeenCalledWith('The story state "tab" could not be saved.');
		expect(isStale()).toBe(true);
	});
});
