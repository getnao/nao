// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useInactivityTrigger } from './use-inactivity-trigger';

const DELAY = 10_000;

function advance(ms: number) {
	act(() => {
		vi.advanceTimersByTime(ms);
	});
}

describe('useInactivityTrigger', () => {
	beforeEach(() => vi.useFakeTimers());
	afterEach(() => vi.useRealTimers());

	it('triggers once the delay elapses', () => {
		const { result } = renderHook(() => useInactivityTrigger({ enabled: true, delayMs: DELAY, resetKey: 'a' }));

		advance(DELAY - 1);
		expect(result.current).toBe(false);

		advance(1);
		expect(result.current).toBe(true);
	});

	it('restarts the countdown when the reset key changes', () => {
		const { result, rerender } = renderHook(
			({ resetKey }: { resetKey: string }) => useInactivityTrigger({ enabled: true, delayMs: DELAY, resetKey }),
			{ initialProps: { resetKey: 'a' } },
		);

		advance(DELAY);
		expect(result.current).toBe(true);

		rerender({ resetKey: 'b' });
		expect(result.current).toBe(false);

		advance(DELAY);
		expect(result.current).toBe(true);
	});

	it('never triggers while disabled', () => {
		const { result } = renderHook(() => useInactivityTrigger({ enabled: false, delayMs: DELAY, resetKey: 'a' }));

		advance(DELAY * 5);
		expect(result.current).toBe(false);
	});

	it('turns off while paused and waits a full delay again after unpausing', () => {
		const { result, rerender } = renderHook(
			({ isPaused }: { isPaused: boolean }) =>
				useInactivityTrigger({ enabled: true, delayMs: DELAY, resetKey: 'a', isPaused }),
			{ initialProps: { isPaused: false } },
		);

		advance(DELAY);
		expect(result.current).toBe(true);

		rerender({ isPaused: true });
		expect(result.current).toBe(false);

		rerender({ isPaused: false });
		expect(result.current).toBe(false);

		advance(DELAY - 1);
		expect(result.current).toBe(false);

		advance(1);
		expect(result.current).toBe(true);
	});

	it('reports the trigger as ignored when a pause interrupts it', () => {
		const onIgnored = vi.fn();
		const { rerender } = renderHook(
			({ isPaused }: { isPaused: boolean }) =>
				useInactivityTrigger({ enabled: true, delayMs: DELAY, resetKey: 'a', isPaused, onIgnored }),
			{ initialProps: { isPaused: false } },
		);

		advance(DELAY);
		rerender({ isPaused: true });

		expect(onIgnored).toHaveBeenCalledTimes(1);
	});

	it('does not report an ignored trigger when the pause starts before it fires', () => {
		const onIgnored = vi.fn();
		const { rerender } = renderHook(
			({ isPaused }: { isPaused: boolean }) =>
				useInactivityTrigger({ enabled: true, delayMs: DELAY, resetKey: 'a', isPaused, onIgnored }),
			{ initialProps: { isPaused: false } },
		);

		advance(DELAY - 1);
		rerender({ isPaused: true });
		advance(DELAY);

		expect(onIgnored).not.toHaveBeenCalled();
	});

	it('does not report an ignored trigger when the reset key already cleared it', () => {
		const onIgnored = vi.fn();
		const { rerender } = renderHook(
			({ isPaused, resetKey }: { isPaused: boolean; resetKey: string }) =>
				useInactivityTrigger({ enabled: true, delayMs: DELAY, resetKey, isPaused, onIgnored }),
			{ initialProps: { isPaused: false, resetKey: 'a' } },
		);

		advance(DELAY);
		rerender({ isPaused: false, resetKey: 'b' });
		rerender({ isPaused: true, resetKey: 'b' });

		expect(onIgnored).not.toHaveBeenCalled();
	});

	it('applies a longer delay once the caller backs off after an ignored trigger', () => {
		const longerDelay = DELAY * 2;
		const { result, rerender } = renderHook(
			({ isPaused, delayMs }: { isPaused: boolean; delayMs: number }) =>
				useInactivityTrigger({ enabled: true, delayMs, resetKey: 'a', isPaused }),
			{ initialProps: { isPaused: false, delayMs: DELAY } },
		);

		advance(DELAY);
		expect(result.current).toBe(true);

		rerender({ isPaused: true, delayMs: longerDelay });
		rerender({ isPaused: false, delayMs: longerDelay });

		advance(DELAY);
		expect(result.current).toBe(false);

		advance(DELAY);
		expect(result.current).toBe(true);
	});
});
