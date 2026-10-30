import { splitCodeIntoSegments } from '@nao/shared/story-segments';
import type { Segment } from '@nao/shared/story-segments';
import type { StoryElementAsk } from '@nao/shared/story-app';
import type { StoryTab } from '@nao/shared/story-tabs';
import type { StoryBlockReference } from '@nao/shared/types';

import { chartBlockReference, mapBlockReference, tableBlockReference } from '@/components/story-block';
import { toQuoteStarts } from '@/story-runtime/story-highlight';

/**
 * The tab holding a cited element: the block it names, else the tab quoting the longest start of its text.
 * The active tab wins a tie, so a citation it shows never moves the reader to another tab.
 */
export function findCitedTabIndex(
	tabs: StoryTab[],
	{ block, text }: StoryElementAsk,
	activeIndex: number,
): number | null {
	const searchOrder = [activeIndex, ...tabs.keys()].filter(
		(index, position, all) => index < tabs.length && all.indexOf(index) === position,
	);
	if (block.kind !== 'text') {
		const blockTabIndex = searchOrder.find((index) => holdsBlock(tabs[index].innerCode, block));
		if (blockTabIndex !== undefined) {
			return blockTabIndex;
		}
	}
	return findQuotingTabIndex(tabs, searchOrder, text);
}

function holdsBlock(code: string, cited: StoryBlockReference): boolean {
	return listBlockReferences(splitCodeIntoSegments(code)).some(
		(block) =>
			block.kind === cited.kind && block.queryId === cited.queryId && (block.title ?? '') === (cited.title ?? ''),
	);
}

function listBlockReferences(segments: Segment[]): StoryBlockReference[] {
	return segments.flatMap((segment) => {
		if (segment.type === 'chart') {
			return [chartBlockReference(segment.chart)];
		}
		if (segment.type === 'table') {
			return [tableBlockReference(segment.table)];
		}
		if (segment.type === 'map') {
			return [mapBlockReference(segment.map)];
		}
		return segment.type === 'grid' ? listBlockReferences(segment.children) : [];
	});
}

function findQuotingTabIndex(tabs: StoryTab[], searchOrder: number[], text: string): number | null {
	const tabTexts = searchOrder.map((index) => toReadText(tabs[index].innerCode));
	for (const start of toQuoteStarts(text)) {
		const position = tabTexts.findIndex((tabText) => tabText.includes(start));
		if (position !== -1) {
			return searchOrder[position];
		}
	}
	return null;
}

/** The markdown of a tab as a reader sees it: without tags, link targets or emphasis marks. */
function toReadText(markdown: string): string {
	return markdown
		.replace(/<[^>]*>/g, ' ')
		.replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
		.replace(/[*_`~#>|]/g, '')
		.replace(/\s+/g, ' ')
		.trim();
}
