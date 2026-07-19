import { getGridClass } from '@nao/shared/story-segments';
import { Fragment, memo, useMemo } from 'react';
import { Streamdown } from 'streamdown';
import type { ParsedChartBlock, ParsedTableBlock, Segment } from '@nao/shared/story-segments';

import { MarkdownTable } from '@/components/chat-messages/markdown-table';
import { markdownPlugins } from '@/lib/markdown';

const markdownComponents = {
	table: ({ node, className }: any) => <MarkdownTable node={node} className={className} />,
};

interface SegmentRendererProps {
	segments: Segment[];
	versionKey?: string | number;
	renderChart: (chart: ParsedChartBlock, key: number) => React.ReactNode;
	renderTable: (table: ParsedTableBlock, key: number) => React.ReactNode;
}

export const SegmentList = memo(function SegmentList({
	segments,
	versionKey,
	renderChart,
	renderTable,
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
					case 'grid':
						return (
							<StoryGrid
								key={key}
								cols={segment.cols}
								children={segment.children}
								renderChart={renderChart}
								renderTable={renderTable}
							/>
						);
				}
			})}
		</>
	);
});

const StoryGrid = memo(function StoryGrid({
	cols,
	children,
	renderChart,
	renderTable,
}: {
	cols: number;
	children: Segment[];
	renderChart: (chart: ParsedChartBlock, key: number) => React.ReactNode;
	renderTable: (table: ParsedTableBlock, key: number) => React.ReactNode;
}) {
	const gridClass = useMemo(() => getGridClass(cols), [cols]);

	return (
		<div className='@container'>
			<div className={`grid ${gridClass} gap-4`}>
				{children.map((segment, i) => (
					<div key={i} className='min-w-0'>
						{segment.type === 'markdown' ? (
							<Streamdown mode='static' plugins={markdownPlugins} components={markdownComponents}>
								{segment.content}
							</Streamdown>
						) : segment.type === 'chart' ? (
							renderChart(segment.chart, i)
						) : segment.type === 'table' ? (
							renderTable(segment.table, i)
						) : segment.type === 'grid' ? (
							<StoryGrid
								cols={segment.cols}
								children={segment.children}
								renderChart={renderChart}
								renderTable={renderTable}
							/>
						) : null}
					</div>
				))}
			</div>
		</div>
	);
});
