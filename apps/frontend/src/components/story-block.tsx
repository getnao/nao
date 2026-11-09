import type { ReactNode } from 'react';
import type { ParsedChartBlock, ParsedMapBlock, ParsedTableBlock } from '@nao/shared/story-segments';
import type { StoryBlockReference } from '@nao/shared/types';

import { cn } from '@/lib/utils';

interface StoryContainerProps {
	children: ReactNode;
	className?: string;
	block?: StoryBlockReference;
}

export function StoryBlock({ children, className, block }: StoryContainerProps) {
	return (
		<div className={cn('story-block', className)} {...toBlockAttributes(block)}>
			{children}
		</div>
	);
}

export function StoryMapFrame({ children, className, block }: StoryContainerProps) {
	return (
		<StoryBlock className={cn('story-map-block', className)} block={block}>
			{children}
		</StoryBlock>
	);
}

export function StoryTableFrame({ children, className, block }: StoryContainerProps) {
	return (
		<div className={cn('story-table', className)} {...toBlockAttributes(block)}>
			{children}
		</div>
	);
}

export function chartBlockReference({ chartType, title, queryId }: ParsedChartBlock): StoryBlockReference {
	const kind = chartType === 'kpi_card' ? 'kpi' : `${chartType.replaceAll('_', '-')}-chart`;
	return { kind, title: title || undefined, queryId };
}

export function tableBlockReference({ title, queryId }: ParsedTableBlock): StoryBlockReference {
	return { kind: 'data-table', title: title || undefined, queryId };
}

export function mapBlockReference({ mapType, title, queryId }: ParsedMapBlock): StoryBlockReference {
	return { kind: MAP_BLOCK_KINDS[mapType], title: title || undefined, queryId };
}

const MAP_BLOCK_KINDS: Record<ParsedMapBlock['mapType'], string> = {
	points: 'point-map',
	scatter_bubble: 'bubble-map',
	choropleth: 'choropleth-map',
};

function toBlockAttributes(block: StoryBlockReference | undefined) {
	if (!block) {
		return {};
	}
	return {
		'data-nao-block-kind': block.kind,
		'data-nao-block-title': block.title,
		'data-nao-block-query': block.queryId,
	};
}
