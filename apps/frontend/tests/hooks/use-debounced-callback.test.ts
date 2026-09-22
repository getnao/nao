// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useDebouncedCallback } from '@/hooks/use-debounced-callback';

describe('useDebouncedCallback', () => {
	afterEach(() => {
		vi.useRealTimers();
	});

	it('invokes once with the latest arguments after rapid calls', () => {
		vi.useFakeTimers();
		const callback = vi.fn();
		const { result } = renderHook(() => useDebouncedCallback(callback, 120));

		act(() => {
			result.current('first');
			vi.advanceTimersByTime(60);
			result.current('second');
			result.current('third');
		});

		expect(callback).not.toHaveBeenCalled();
		act(() => vi.advanceTimersByTime(120));
		expect(callback).toHaveBeenCalledOnce();
		expect(callback).toHaveBeenCalledWith('third');
	});

	it('clears a pending callback on unmount', () => {
		vi.useFakeTimers();
		const callback = vi.fn();
		const { result, unmount } = renderHook(() => useDebouncedCallback(callback, 120));

		act(() => result.current());
		expect(vi.getTimerCount()).toBe(1);
		unmount();
		expect(vi.getTimerCount()).toBe(0);

		act(() => vi.advanceTimersByTime(120));
		expect(callback).not.toHaveBeenCalled();
	});
});
