import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

import type { FilterSlot } from '@/lib/story-filter-overflow';
import { selectVisibleFilterIds } from '@/lib/story-filter-overflow';

/**
 * Keeps the filters that fit on one row of the bar. A folded filter has no width to read, so the last
 * width seen in the row is reused, and one never seen counts as zero so it is shown once and measured.
 * A filter in use (its picker open or its text field focused) never moves: a re-fold that would shift
 * or fold it waits until that ends, and nothing re-folds while the fold menu is open. Nor while the
 * bar itself is pressed: the menu closes on press, so a click on a filter must land before the row
 * reshuffles. A bar that is not laid out (zero width) is left as is.
 */
export function useFilterRowOverflow({ slots, showClear }: { slots: FilterSlot[]; showClear: boolean }) {
	const containerRef = useRef<HTMLDivElement>(null);
	const slotWidths = useRef(new Map<string, number>());
	const isBarPressed = useRef(false);
	const hasMeasureAfterPress = useRef(false);
	const [visibleIds, setVisibleIds] = useState<ReadonlySet<string> | null>(null);

	const measure = useCallback(() => {
		if (isBarPressed.current) {
			hasMeasureAfterPress.current = true;
			return;
		}
		const container = containerRef.current;
		const row = container?.querySelector<HTMLElement>('[data-filter-row]');
		const availableWidth = row?.getBoundingClientRect().width ?? 0;
		const controlInUse = row?.querySelector<HTMLElement>("[aria-expanded='true'], input:focus");
		const slotInUse = controlInUse?.closest<HTMLElement>('[data-filter-slot]')?.dataset.filterSlot;
		if (!container || !row || availableWidth === 0 || (controlInUse && !slotInUse)) {
			return;
		}
		for (const slot of row.querySelectorAll<HTMLElement>('[data-filter-slot]')) {
			slotWidths.current.set(slot.dataset.filterSlot ?? '', slot.getBoundingClientRect().width);
		}
		const nextVisibleIds = selectVisibleFilterIds({
			slots: slots.map((slot) => ({ ...slot, width: slotWidths.current.get(slot.id) ?? 0 })),
			availableWidth,
			gap: Number.parseFloat(getComputedStyle(row).columnGap) || 0,
			overflowButtonWidth: measuredButtonWidth(container, 'overflow'),
			clearButtonWidth: showClear ? measuredButtonWidth(container, 'clear') : 0,
		});
		setVisibleIds((current) => {
			const isUnchanged = current !== null && haveSameIds(current, nextVisibleIds);
			const wouldMoveSlotInUse =
				current !== null && slotInUse !== undefined && movesSlot(slots, current, nextVisibleIds, slotInUse);
			return isUnchanged || wouldMoveSlotInUse ? current : nextVisibleIds;
		});
	}, [slots, showClear]);

	useLayoutEffect(() => {
		measure();
		const row = containerRef.current?.querySelector<HTMLElement>('[data-filter-row]');
		if (!row) {
			return;
		}
		const resizeObserver = new ResizeObserver(measure);
		resizeObserver.observe(row);
		row.querySelectorAll('[data-filter-slot]').forEach((slot) => resizeObserver.observe(slot));
		const pickerObserver = new MutationObserver(measure);
		pickerObserver.observe(row, { attributeFilter: ['aria-expanded'], subtree: true });
		const measureOnceFocusSettles = () => {
			requestAnimationFrame(measure);
		};
		row.addEventListener('focusout', measureOnceFocusSettles);
		return () => {
			resizeObserver.disconnect();
			pickerObserver.disconnect();
			row.removeEventListener('focusout', measureOnceFocusSettles);
		};
	}, [measure, visibleIds]);

	useEffect(() => {
		const markPressed = (event: PointerEvent) => {
			isBarPressed.current = containerRef.current?.contains(event.target as Node) ?? false;
		};
		const measureOnceClickLands = () => {
			isBarPressed.current = false;
			if (hasMeasureAfterPress.current) {
				hasMeasureAfterPress.current = false;
				requestAnimationFrame(measure);
			}
		};
		document.addEventListener('pointerdown', markPressed, true);
		document.addEventListener('pointerup', measureOnceClickLands, true);
		document.addEventListener('pointercancel', measureOnceClickLands, true);
		return () => {
			document.removeEventListener('pointerdown', markPressed, true);
			document.removeEventListener('pointerup', measureOnceClickLands, true);
			document.removeEventListener('pointercancel', measureOnceClickLands, true);
		};
	}, [measure]);

	const isVisible = (id: string) => {
		return visibleIds === null || visibleIds.has(id);
	};

	return { containerRef, isVisible };
}

/** Whether the next fold changes the filters shown up to `slotId`, which would shift or hide it. */
function movesSlot(
	slots: FilterSlot[],
	current: ReadonlySet<string>,
	next: ReadonlySet<string>,
	slotId: string,
): boolean {
	const slotsUpToInUse = slots.slice(0, slots.findIndex((slot) => slot.id === slotId) + 1);
	return slotsUpToInUse.some((slot) => current.has(slot.id) !== next.has(slot.id));
}

function measuredButtonWidth(container: HTMLElement, name: 'overflow' | 'clear'): number {
	return container.querySelector(`[data-filter-measure='${name}']`)?.getBoundingClientRect().width ?? 0;
}

function haveSameIds(current: ReadonlySet<string>, next: ReadonlySet<string>): boolean {
	return current.size === next.size && [...next].every((id) => current.has(id));
}
