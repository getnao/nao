import { describe, expect, it, vi } from 'vitest';

import { createMapSlotBudget } from '@/lib/map-slot-budget';

describe('map slot budget', () => {
	it('grants slots up to the limit and queues the rest', () => {
		const budget = createMapSlotBudget(2);
		const granted = [vi.fn(), vi.fn(), vi.fn()];

		granted.forEach((onGranted) => budget.acquire(onGranted));

		expect(granted[0]).toHaveBeenCalledOnce();
		expect(granted[1]).toHaveBeenCalledOnce();
		expect(granted[2]).not.toHaveBeenCalled();
		expect(budget.liveCount()).toBe(2);
	});

	it('hands a released slot to the oldest waiting request', () => {
		const budget = createMapSlotBudget(1);
		const releaseFirst = budget.acquire(vi.fn());
		const second = vi.fn();
		const third = vi.fn();
		budget.acquire(second);
		budget.acquire(third);

		releaseFirst();

		expect(second).toHaveBeenCalledOnce();
		expect(third).not.toHaveBeenCalled();
		expect(budget.liveCount()).toBe(1);
	});

	it('drops a waiting request that is released before being granted', () => {
		const budget = createMapSlotBudget(1);
		const releaseFirst = budget.acquire(vi.fn());
		const abandoned = vi.fn();
		const releaseAbandoned = budget.acquire(abandoned);

		releaseAbandoned();
		releaseFirst();

		expect(abandoned).not.toHaveBeenCalled();
		expect(budget.liveCount()).toBe(0);
	});

	it('ignores a release called twice', () => {
		const budget = createMapSlotBudget(1);
		const release = budget.acquire(vi.fn());
		const waiting = vi.fn();
		budget.acquire(waiting);

		release();
		release();

		expect(waiting).toHaveBeenCalledOnce();
		expect(budget.liveCount()).toBe(1);
	});
});
