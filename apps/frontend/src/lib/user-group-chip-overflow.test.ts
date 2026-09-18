import { describe, expect, it } from 'vitest';

import { calculateVisibleGroupChipCount } from './user-group-chip-overflow';

describe('calculateVisibleGroupChipCount', () => {
	it('shows every group when all chips fit', () => {
		expect(
			calculateVisibleGroupChipCount({
				availableWidth: 74,
				groupChipWidths: [30, 40],
				overflowChipWidths: [],
				gap: 4,
			}),
		).toBe(2);
	});

	it('reserves room for the remaining-count chip', () => {
		const input = {
			groupChipWidths: [30, 40, 50],
			overflowChipWidths: [0, 20, 20, 20],
			gap: 4,
		};

		expect(calculateVisibleGroupChipCount({ ...input, availableWidth: 100 })).toBe(2);
		expect(calculateVisibleGroupChipCount({ ...input, availableWidth: 90 })).toBe(1);
	});

	it('shows only the remaining-count chip when a name is too long', () => {
		expect(
			calculateVisibleGroupChipCount({
				availableWidth: 50,
				groupChipWidths: [200],
				overflowChipWidths: [0, 22],
				gap: 4,
			}),
		).toBe(0);
	});

	it('handles zero width and no groups', () => {
		expect(
			calculateVisibleGroupChipCount({
				availableWidth: 0,
				groupChipWidths: [30, 40],
				overflowChipWidths: [0, 20, 20],
				gap: 4,
			}),
		).toBe(0);
		expect(
			calculateVisibleGroupChipCount({
				availableWidth: 100,
				groupChipWidths: [],
				overflowChipWidths: [],
				gap: 4,
			}),
		).toBe(0);
	});

	it('recalculates from the supplied width after a resize', () => {
		const input = {
			groupChipWidths: [35, 35, 35],
			overflowChipWidths: [0, 20, 20, 20],
			gap: 4,
		};

		expect(calculateVisibleGroupChipCount({ ...input, availableWidth: 113 })).toBe(3);
		expect(calculateVisibleGroupChipCount({ ...input, availableWidth: 63 })).toBe(1);
	});
});
