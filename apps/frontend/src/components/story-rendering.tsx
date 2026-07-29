import { getGridClass, getGridTemplateColumns } from '@nao/shared/story-segments';
import { Fragment, memo } from 'react';
import { Streamdown } from 'streamdown';
import type { ParsedChartBlock, ParsedMapBlock, ParsedTableBlock, Segment } from '@nao/shared/story-segments';

import { MarkdownTable } from '@/components/chat-messages/markdown-table';
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
	return (
		<>
			{segments.map((segment, i) => {
				const key = versionKey != null ? `${versionKey}-${i}` : i;
				switch (segment.type) {
					case 'markdown':
						return (
							<Streamdown
								key={key}
								mode='static'
								plugins={markdownPlugins}
								components={markdownComponents}
							>
								{segment.content}
							</Streamdown>
						);
					case 'chart':
						return <Fragment key={key}>{renderChart(segment.chart, i)}</Fragment>;
					case 'table':
						return <Fragment key={key}>{renderTable(segment.table, i)}</Fragment>;
					case 'map':
						return <Fragment key={key}>{renderMap(segment.map, i)}</Fragment>;
					case 'filter':
						return null;
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
					<StoryGridProvider key={i}>
						<div className='min-w-0'>
							{segment.type === 'markdown' ? (
								<Streamdown mode='static' plugins={markdownPlugins} components={markdownComponents}>
									{segment.content}
								</Streamdown>
							) : segment.type === 'chart' ? (
								renderChart(segment.chart, i)
							) : segment.type === 'table' ? (
								renderTable(segment.table, i)
							) : segment.type === 'map' ? (
								renderMap(segment.map, i)
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
