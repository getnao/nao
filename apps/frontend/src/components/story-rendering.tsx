import { Fragment, memo, useMemo } from 'react';
import { Streamdown } from 'streamdown';
import type { Segment, ParsedChartBlock, ParsedTableBlock } from '@/lib/story-segments';
import { getGridClass } from '@/lib/story-segments';

interface SegmentRendererProps {
	segments: Segment[];
	renderChart: (chart: ParsedChartBlock, key: number) => React.ReactNode;
	renderTable: (table: ParsedTableBlock, key: number) => React.ReactNode;
}

export const SegmentList = memo(function SegmentList({ segments, renderChart, renderTable }: SegmentRendererProps) {
	return (
		<>
			{segments.map((segment, i) => {
				switch (segment.type) {
					case 'markdown':
						return (
							<Streamdown key={i} mode='static'>
								{segment.content}
							</Streamdown>
						);
					case 'chart':
						return <Fragment key={i}>{renderChart(segment.chart, i)}</Fragment>;
					case 'table':
						return <Fragment key={i}>{renderTable(segment.table, i)}</Fragment>;
					case 'grid':
						return (
							<StoryGrid
								key={i}
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
							<Streamdown mode='static'>{segment.content}</Streamdown>
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
