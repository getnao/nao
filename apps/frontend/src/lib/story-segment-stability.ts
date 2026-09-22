import type {
	ParsedChartBlock,
	ParsedFilterBlock,
	ParsedMapBlock,
	ParsedTableBlock,
	Segment,
} from '@nao/shared/story-segments';

type StoryBlock = ParsedChartBlock | ParsedTableBlock | ParsedMapBlock | ParsedFilterBlock;
type StoryBlockType = 'chart' | 'table' | 'map' | 'filter';

export function stabilizeStorySegments(segments: Segment[], previousSegments: Segment[]): Segment[] {
	const previousBlocks = collectStoryBlocks(previousSegments);
	const occurrences = new Map<string, number>();
	return segments.map((segment) => stabilizeSegment(segment, previousBlocks, occurrences));
}

function stabilizeSegment(
	segment: Segment,
	previousBlocks: Map<string, StoryBlock>,
	occurrences: Map<string, number>,
): Segment {
	switch (segment.type) {
		case 'chart':
			return { ...segment, chart: reuseStoryBlock('chart', segment.chart, previousBlocks, occurrences) };
		case 'table':
			return { ...segment, table: reuseStoryBlock('table', segment.table, previousBlocks, occurrences) };
		case 'map':
			return { ...segment, map: reuseStoryBlock('map', segment.map, previousBlocks, occurrences) };
		case 'filter':
			return { ...segment, filter: reuseStoryBlock('filter', segment.filter, previousBlocks, occurrences) };
		case 'grid':
			return {
				...segment,
				children: segment.children.map((child) => stabilizeSegment(child, previousBlocks, occurrences)),
			};
		case 'markdown':
			return segment;
	}
}

function collectStoryBlocks(segments: Segment[]): Map<string, StoryBlock> {
	const blocks = new Map<string, StoryBlock>();
	const occurrences = new Map<string, number>();

	const collect = (segment: Segment) => {
		switch (segment.type) {
			case 'chart':
				storeStoryBlock('chart', segment.chart, blocks, occurrences);
				break;
			case 'table':
				storeStoryBlock('table', segment.table, blocks, occurrences);
				break;
			case 'map':
				storeStoryBlock('map', segment.map, blocks, occurrences);
				break;
			case 'filter':
				storeStoryBlock('filter', segment.filter, blocks, occurrences);
				break;
			case 'grid':
				segment.children.forEach(collect);
				break;
			case 'markdown':
				break;
		}
	};

	segments.forEach(collect);
	return blocks;
}

function reuseStoryBlock<T extends StoryBlock>(
	type: StoryBlockType,
	block: T,
	previousBlocks: Map<string, StoryBlock>,
	occurrences: Map<string, number>,
): T {
	const key = getStoryBlockKey(type, block.rawTag, occurrences);
	if (!key) {
		return block;
	}
	return (previousBlocks.get(key) as T | undefined) ?? block;
}

function storeStoryBlock(
	type: StoryBlockType,
	block: StoryBlock,
	blocks: Map<string, StoryBlock>,
	occurrences: Map<string, number>,
) {
	const key = getStoryBlockKey(type, block.rawTag, occurrences);
	if (key) {
		blocks.set(key, block);
	}
}

function getStoryBlockKey(
	type: StoryBlockType,
	rawTag: string | undefined,
	occurrences: Map<string, number>,
): string | null {
	if (!rawTag) {
		return null;
	}
	const sourceKey = `${type}:${rawTag}`;
	const occurrence = occurrences.get(sourceKey) ?? 0;
	occurrences.set(sourceKey, occurrence + 1);
	return `${sourceKey}:${occurrence}`;
}
