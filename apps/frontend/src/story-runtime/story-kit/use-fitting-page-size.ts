import { useLayoutEffect, useState } from 'react';
import type { RefObject } from 'react';

/**
 * Grows the page size while the enclosing block, stretched by a taller neighbour in its grid row,
 * leaves room under the table; a width change starts over from the minimum.
 */
export function useFittingPageSize(
	tableRef: RefObject<HTMLElement | null>,
	minimum: number,
	totalRows: number,
	enabled: boolean,
): number {
	const [pageSize, setPageSize] = useState(minimum);

	useLayoutEffect(() => {
		const table = tableRef.current;
		const block = table?.closest<HTMLElement>('.nao-block');
		if (!enabled || !table || !block) {
			return;
		}

		let blockWidth = block.clientWidth;
		const fit = () => {
			if (block.clientWidth !== blockWidth) {
				blockWidth = block.clientWidth;
				setPageSize(minimum);
				return;
			}
			const fittingRows = Math.min(totalRows, countVisibleRows(table) + countRowsFittingBelow(table, block));
			setPageSize((current) => Math.max(current, fittingRows));
		};

		const observer = new ResizeObserver(fit);
		observer.observe(block);
		return () => observer.disconnect();
	}, [tableRef, minimum, totalRows, enabled]);

	return enabled ? pageSize : minimum;
}

function countVisibleRows(table: HTMLElement): number {
	return table.querySelectorAll('tbody tr').length;
}

function countRowsFittingBelow(table: HTMLElement, block: HTMLElement): number {
	const rowHeight = table.querySelector('tbody tr')?.getBoundingClientRect().height ?? 0;
	if (rowHeight <= 0) {
		return 0;
	}
	const blockStyle = getComputedStyle(block);
	const blockContentBottom =
		block.getBoundingClientRect().bottom -
		(parseFloat(blockStyle.paddingBottom) || 0) -
		(parseFloat(blockStyle.borderBottomWidth) || 0);
	const freeSpace = blockContentBottom - table.getBoundingClientRect().bottom;
	return Math.max(0, Math.floor(freeSpace / rowHeight));
}
