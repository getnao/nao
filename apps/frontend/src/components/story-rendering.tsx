import { getGridClass, getGridTemplateColumns } from '@nao/shared/story-segments';
import { Fragment, memo } from 'react';
import { Streamdown } from 'streamdown';
import type { ParsedChartBlock, ParsedMapBlock, ParsedTableBlock, Segment } from '@nao/shared/story-segments';

import { MarkdownTable } from '@/components/chat-messages/markdown-table';
import { StoryPluginEmbed } from '@/components/story-plugin-embed';
import { StoryGridProvider } from '@/contexts/story-grid';
import { markdownPlugins } from '@/lib/markdown';

const markdownComponents = {
	table: ({ node, className }: any) => <MarkdownTable node={node} className={className} />,
};

interface SegmentRendererProps {
	segments: Segment[];
	versionKey?: string | number;
	renderChart: (chart: ParsedChartBlock, key: number) => React.ReactNode;
	renderTable: (table: ParsedTableBlock, key: number) => React.ReactNode;
	renderMap: (map: ParsedMapBlock, key: number) => React.ReactNode;
}

export const SegmentList = memo(function SegmentList({
	segments,
	versionKey,
	renderChart,
	renderTable,
	renderMap,
}: SegmentRendererProps) {
	const blockOccurrences = new Map<string, number>();

	return (
		<>
			{segments.map((segment, i) => {
				const key = getSegmentKey(segment, i, blockOccurrences, versionKey);
				switch (segment.type) {
					case 'markdown':
						return <MarkdownSegment key={key} content={segment.content} />;
					case 'chart':
						return <Fragment key={key}>{renderChart(segment.chart, i)}</Fragment>;
					case 'table':
						return <Fragment key={key}>{renderTable(segment.table, i)}</Fragment>;
					case 'map':
						return <Fragment key={key}>{renderMap(segment.map, i)}</Fragment>;
					case 'filter':
						return null;
					case 'plugin':
						return <StoryPluginEmbed key={key} plugin={segment.plugin} />;
					case 'grid':
						return (
							<StoryGrid
								key={key}
								cols={segment.cols}
								widths={segment.widths}
								children={segment.children}
								renderChart={renderChart}
								renderTable={renderTable}
								renderMap={renderMap}
							/>
						);
				}
			})}
		</>
	);
});

const MarkdownSegment = memo(function MarkdownSegment({ content }: { content: string }) {
	return (
		<Streamdown mode='static' plugins={markdownPlugins} components={markdownComponents}>
			{content}
		</Streamdown>
	);
});

const StoryGrid = memo(function StoryGrid({
	cols,
	widths,
	children,
	renderChart,
	renderTable,
	renderMap,
}: {
	cols: number;
	widths: number[] | null;
	children: Segment[];
	renderChart: (chart: ParsedChartBlock, key: number) => React.ReactNode;
	renderTable: (table: ParsedTableBlock, key: number) => React.ReactNode;
	renderMap: (map: ParsedMapBlock, key: number) => React.ReactNode;
}) {
	const blockOccurrences = new Map<string, number>();

	return (
		<div className='@container'>
			<div
				className={
					widths !== null
						? 'grid grid-cols-1 gap-4 @lg:[grid-template-columns:var(--nao-grid-cols)]'
						: `grid ${getGridClass(cols)} gap-4`
				}
				{...(widths !== null
					? { style: { ['--nao-grid-cols' as string]: getGridTemplateColumns(widths) } }
					: {})}
			>
				{children.map((segment, i) => (
					<StoryGridProvider key={getSegmentKey(segment, i, blockOccurrences)}>
						<div className='min-w-0'>
							{segment.type === 'markdown' ? (
								<MarkdownSegment content={segment.content} />
							) : segment.type === 'chart' ? (
								renderChart(segment.chart, i)
							) : segment.type === 'table' ? (
								renderTable(segment.table, i)
							) : segment.type === 'map' ? (
								renderMap(segment.map, i)
							) : segment.type === 'plugin' ? (
								<StoryPluginEmbed plugin={segment.plugin} />
							) : segment.type === 'grid' ? (
								<StoryGrid
									cols={segment.cols}
									widths={segment.widths}
									children={segment.children}
									renderChart={renderChart}
									renderTable={renderTable}
									renderMap={renderMap}
								/>
							) : null}
						</div>
					</StoryGridProvider>
				))}
			</div>
		</div>
	);
});

function getSegmentKey(
	segment: Segment,
	index: number,
	blockOccurrences: Map<string, number>,
	versionKey?: string | number,
): string {
	const blockIdentity = getBlockIdentity(segment, blockOccurrences);
	const segmentIdentity = blockIdentity ?? `index:${index}`;
	return versionKey != null ? `${versionKey}:${segmentIdentity}` : segmentIdentity;
}

function getBlockIdentity(segment: Segment, blockOccurrences: Map<string, number>): string | null {
	const rawTag =
		segment.type === 'chart'
			? segment.chart.rawTag
			: segment.type === 'table'
				? segment.table.rawTag
				: segment.type === 'map'
					? segment.map.rawTag
					: undefined;
	if (!rawTag || (segment.type !== 'chart' && segment.type !== 'table' && segment.type !== 'map')) {
		return null;
	}

	const sourceKey = `${segment.type}:${rawTag}`;
	const occurrence = blockOccurrences.get(sourceKey) ?? 0;
	blockOccurrences.set(sourceKey, occurrence + 1);
	return `block:${sourceKey}:${occurrence}`;
}
