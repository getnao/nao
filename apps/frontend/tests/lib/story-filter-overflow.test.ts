import { describe, expect, it } from 'vitest';

import type { FilterSlotMeasurement } from '@/lib/story-filter-overflow';
import { selectVisibleFilterIds } from '@/lib/story-filter-overflow';

const GAP = 10;
const OVERFLOW_BUTTON_WIDTH = 60;

describe('selectVisibleFilterIds', () => {
	it.each([
		{
			case: 'shows every filter when the row fits them',
			slots: [slot('a'), slot('b'), slot('c')],
			availableWidth: 320,
			clearButtonWidth: 0,
			expected: ['a', 'b', 'c'],
		},
		{
			case: 'folds the last filters and leaves room for the "+N filters" button',
			slots: [slot('a'), slot('b'), slot('c'), slot('d')],
			availableWidth: 330,
			clearButtonWidth: 0,
			expected: ['a', 'b'],
		},
		{
			case: 'keeps an active filter from the end of the list and fills the rest in order',
			slots: [slot('a'), slot('b'), slot('c'), slot('d', { isActive: true })],
			availableWidth: 330,
			clearButtonWidth: 0,
			expected: ['d', 'a'],
		},
		{
			case: 'leaves room for the Clear button',
			slots: [slot('a'), slot('b'), slot('c')],
			availableWidth: 330,
			clearButtonWidth: 50,
			expected: ['a'],
		},
		{
			case: 'keeps active filters even when they alone overflow the row',
			slots: [slot('a', { width: 200, isActive: true }), slot('b', { width: 200, isActive: true }), slot('c')],
			availableWidth: 300,
			clearButtonWidth: 0,
			expected: ['a', 'b'],
		},
	])('$case', ({ slots, availableWidth, clearButtonWidth, expected }) => {
		const visibleIds = selectVisibleFilterIds({
			slots,
			availableWidth,
			gap: GAP,
			overflowButtonWidth: OVERFLOW_BUTTON_WIDTH,
			clearButtonWidth,
		});

		expect([...visibleIds]).toEqual(expected);
	});
});

function slot(id: string, overrides: Partial<FilterSlotMeasurement> = {}): FilterSlotMeasurement {
	return { id, width: 100, isActive: false, ...overrides };
}
