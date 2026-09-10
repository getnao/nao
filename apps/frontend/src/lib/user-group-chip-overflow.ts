type GroupChipOverflowInput = {
	availableWidth: number;
	groupChipWidths: number[];
	overflowChipWidths: number[];
	gap: number;
};

export function calculateVisibleGroupChipCount({
	availableWidth,
	groupChipWidths,
	overflowChipWidths,
	gap,
}: GroupChipOverflowInput): number {
	const width = Math.max(0, availableWidth);
	const chipGap = Math.max(0, gap);
	const groupCount = groupChipWidths.length;

	if (groupCount === 0) {
		return 0;
	}

	const widths = groupChipWidths.map((chipWidth) => Math.max(0, chipWidth));
	const allGroupsWidth = sum(widths) + chipGap * Math.max(0, groupCount - 1);
	if (allGroupsWidth <= width) {
		return groupCount;
	}

	let visibleGroupsWidth = sum(widths.slice(0, -1));
	for (let visibleCount = groupCount - 1; visibleCount >= 0; visibleCount--) {
		const hiddenCount = groupCount - visibleCount;
		const overflowWidth = overflowChipWidths[hiddenCount] ?? Number.POSITIVE_INFINITY;
		const totalWidth = visibleGroupsWidth + Math.max(0, overflowWidth) + chipGap * visibleCount;
		if (totalWidth <= width) {
			return visibleCount;
		}
		visibleGroupsWidth -= widths[visibleCount - 1] ?? 0;
	}

	return 0;
}

function sum(values: number[]): number {
	return values.reduce((total, value) => total + value, 0);
}
