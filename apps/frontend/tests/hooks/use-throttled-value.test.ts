// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useThrottledValue } from '@/hooks/use-throttled-value';

describe('useThrottledValue', () => {
	afterEach(() => {
		vi.useRealTimers();
	});

	it('emits the leading value and the latest trailing value', () => {
		vi.useFakeTimers();
		const { result, rerender } = renderHook(({ value, enabled }) => useThrottledValue(value, 120, enabled), {
			initialProps: { value: 'first', enabled: true },
		});

		expect(result.current).toBe('first');
		rerender({ value: 'second', enabled: true });
		act(() => vi.advanceTimersByTime(60));
		rerender({ value: 'third', enabled: true });
		act(() => vi.advanceTimersByTime(59));
		expect(result.current).toBe('first');
		act(() => vi.advanceTimersByTime(1));
		expect(result.current).toBe('third');
	});

	it('passes through immediately when throttling ends', () => {
		vi.useFakeTimers();
		const { result, rerender } = renderHook(({ value, enabled }) => useThrottledValue(value, 120, enabled), {
			initialProps: { value: 'first', enabled: true },
		});

		rerender({ value: 'pending', enabled: true });
		expect(result.current).toBe('first');
		rerender({ value: 'final', enabled: false });
		expect(result.current).toBe('final');
		expect(vi.getTimerCount()).toBe(0);
	});

	it('cleans up a pending trailing update on unmount', () => {
		vi.useFakeTimers();
		const { rerender, unmount } = renderHook(({ value }) => useThrottledValue(value, 120), {
			initialProps: { value: 'first' },
		});

		rerender({ value: 'pending' });
		expect(vi.getTimerCount()).toBe(1);
		unmount();
		expect(vi.getTimerCount()).toBe(0);
	});
});
