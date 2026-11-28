export type FilterSlot = {
	id: string;
	isActive: boolean;
};

export type FilterSlotMeasurement = FilterSlot & { width: number };

type FilterOverflowInput = {
	slots: FilterSlotMeasurement[];
	availableWidth: number;
	gap: number;
	overflowButtonWidth: number;
	clearButtonWidth: number;
};

/**
 * Picks the filters that fit on a single row. Active filters always stay visible; the others keep
 * their order until the row is full, leaving room for the "+N filters" button and the Clear button.
 */
export function selectVisibleFilterIds({
	slots,
	availableWidth,
	gap,
	overflowButtonWidth,
	clearButtonWidth,
}: FilterOverflowInput): Set<string> {
	const clearWidth = clearButtonWidth > 0 ? gap + clearButtonWidth : 0;
	if (rowWidth(slots, gap) + clearWidth <= availableWidth) {
		return new Set(slots.map((slot) => slot.id));
	}

	const budget = availableWidth - clearWidth - gap - overflowButtonWidth;
	const activeSlots = slots.filter((slot) => slot.isActive);
	const visibleIds = new Set(activeSlots.map((slot) => slot.id));
	let usedWidth = rowWidth(activeSlots, gap);

	for (const slot of slots.filter((candidate) => !candidate.isActive)) {
		const widthWithSlot = usedWidth + (visibleIds.size > 0 ? gap : 0) + slot.width;
		if (widthWithSlot > budget) {
			break;
		}
		visibleIds.add(slot.id);
		usedWidth = widthWithSlot;
	}

	return visibleIds;
}

function rowWidth(slots: FilterSlotMeasurement[], gap: number): number {
	const slotsWidth = slots.reduce((total, slot) => total + slot.width, 0);
	return slotsWidth + gap * Math.max(0, slots.length - 1);
}
