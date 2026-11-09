// @vitest-environment jsdom

import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useMapSlot } from '@/hooks/use-map-slot';
import { createMapSlotBudget } from '@/lib/map-slot-budget';

const observers = new Map<Element, (entries: Partial<IntersectionObserverEntry>[]) => void>();

beforeEach(() => {
	vi.stubGlobal(
		'IntersectionObserver',
		class {
			constructor(private readonly callback: (entries: Partial<IntersectionObserverEntry>[]) => void) {}
			observe(element: Element) {
				observers.set(element, this.callback);
			}
			disconnect() {}
		},
	);
});

afterEach(() => {
	cleanup();
	observers.clear();
	vi.unstubAllGlobals();
});

describe('useMapSlot', () => {
	it('goes live once its element nears the viewport', () => {
		const budget = createMapSlotBudget(2);
		const element = document.createElement('div');
		const { result } = renderHook(() => useMapSlot(element, budget));

		expect(result.current.isLive).toBe(false);
		setNearViewport(element, true);

		expect(result.current.isLive).toBe(true);
		expect(budget.liveCount()).toBe(1);
	});

	it('stays waiting while the budget is full', () => {
		const budget = createMapSlotBudget(1);
		const [first, second] = [document.createElement('div'), document.createElement('div')];
		renderHook(() => useMapSlot(first, budget));
		const { result } = renderHook(() => useMapSlot(second, budget));

		setNearViewport(first, true);
		setNearViewport(second, true);
		expect(result.current.isLive).toBe(false);

		setNearViewport(first, false);
		expect(result.current.isLive).toBe(true);
	});

	it('releases its slot when leaving the viewport', () => {
		const budget = createMapSlotBudget(1);
		const element = document.createElement('div');
		const { result } = renderHook(() => useMapSlot(element, budget));

		setNearViewport(element, true);
		setNearViewport(element, false);

		expect(result.current.isLive).toBe(false);
		expect(budget.liveCount()).toBe(0);
	});

	it('releases its slot on unmount', () => {
		const budget = createMapSlotBudget(1);
		const element = document.createElement('div');
		const { unmount } = renderHook(() => useMapSlot(element, budget));

		setNearViewport(element, true);
		unmount();

		expect(budget.liveCount()).toBe(0);
	});

	it('releases its slot when its element goes away', () => {
		const budget = createMapSlotBudget(1);
		const element = document.createElement('div');
		const { result, rerender } = renderHook(({ target }) => useMapSlot(target, budget), {
			initialProps: { target: element as HTMLElement | null },
		});
		setNearViewport(element, true);

		rerender({ target: null });

		expect(result.current.isLive).toBe(false);
		expect(budget.liveCount()).toBe(0);
	});

	it('follows the latest entry when several arrive at once', () => {
		const budget = createMapSlotBudget(1);
		const element = document.createElement('div');
		const { result } = renderHook(() => useMapSlot(element, budget));

		act(() => observers.get(element)?.([{ isIntersecting: false }, { isIntersecting: true }]));

		expect(result.current.isLive).toBe(true);
	});

	it('releases its slot after a context loss until resumed', () => {
		const budget = createMapSlotBudget(1);
		const element = document.createElement('div');
		const { result } = renderHook(() => useMapSlot(element, budget));
		setNearViewport(element, true);

		act(() => result.current.pause());
		expect(result.current).toMatchObject({ isLive: false, isPaused: true });
		expect(budget.liveCount()).toBe(0);

		act(() => result.current.resume());
		expect(result.current).toMatchObject({ isLive: true, isPaused: false });
	});
});

function setNearViewport(element: Element, isIntersecting: boolean) {
	act(() => observers.get(element)?.([{ isIntersecting }]));
}
