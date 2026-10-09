// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useStoryStateWriter } from './use-story-state-writer';

const { saveStoryState } = vi.hoisted(() => ({ saveStoryState: vi.fn(() => Promise.resolve()) }));

vi.mock('./story-data-options', () => ({ saveStoryState }));

const DATA_SOURCE = { kind: 'share', storyId: 'story-1' } as const;

describe('useStoryStateWriter', () => {
	beforeEach(() => {
		vi.useFakeTimers();
		saveStoryState.mockClear();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it('saves only the latest change to a key within the delay', () => {
		const { result } = renderHook(() => useStoryStateWriter(DATA_SOURCE, vi.fn()));

		act(() => {
			result.current({ key: 'tab', value: 'revenue', shared: false });
			result.current({ key: 'tab', value: 'orders', shared: false });
			vi.runAllTimers();
		});

		expect(saveStoryState).toHaveBeenCalledTimes(1);
		expect(saveStoryState).toHaveBeenCalledWith(DATA_SOURCE, { key: 'tab', value: 'orders', shared: false });
	});

	it('keeps a shared and a personal change to the same key apart', () => {
		const { result } = renderHook(() => useStoryStateWriter(DATA_SOURCE, vi.fn()));

		act(() => {
			result.current({ key: 'score', value: 9, shared: true });
			result.current({ key: 'score', value: 1, shared: false });
			vi.runAllTimers();
		});

		expect(saveStoryState).toHaveBeenCalledWith(DATA_SOURCE, { key: 'score', value: 9, shared: true });
		expect(saveStoryState).toHaveBeenCalledWith(DATA_SOURCE, { key: 'score', value: 1, shared: false });
	});

	it('saves pending changes right away when the story unmounts', () => {
		const { result, unmount } = renderHook(() => useStoryStateWriter(DATA_SOURCE, vi.fn()));

		act(() => result.current({ key: 'tab', value: 'orders', shared: false }));
		unmount();

		expect(saveStoryState).toHaveBeenCalledWith(DATA_SOURCE, { key: 'tab', value: 'orders', shared: false });
	});

	it('reports a save that fails', async () => {
		saveStoryState.mockRejectedValueOnce(new Error('Forbidden'));
		const reportError = vi.fn();
		const { result } = renderHook(() => useStoryStateWriter(DATA_SOURCE, reportError));

		act(() => {
			result.current({ key: 'tab', value: 'orders', shared: false });
			vi.runAllTimers();
		});
		await act(() => Promise.resolve());

		expect(reportError).toHaveBeenCalledWith('The story state "tab" could not be saved: Forbidden');
	});
});
