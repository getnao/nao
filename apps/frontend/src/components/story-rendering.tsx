import { Fragment } from 'react';
import { Streamdown } from 'streamdown';
import type { Segment, ParsedChartBlock } from '@/lib/story-segments';
import { getGridClass } from '@/lib/story-segments';

interface SegmentRendererProps {
	segments: Segment[];
	renderChart: (chart: ParsedChartBlock, key: number) => React.ReactNode;
}

export function SegmentList({ segments, renderChart }: SegmentRendererProps) {
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
					case 'grid':
						return (
							<StoryGrid
								key={i}
								cols={segment.cols}
								children={segment.children}
								renderChart={renderChart}
							/>
						);
				}
			})}
		</>
	);
}

function StoryGrid({
	cols,
	children,
	renderChart,
}: {
	cols: number;
	children: Segment[];
	renderChart: (chart: ParsedChartBlock, key: number) => React.ReactNode;
}) {
	const gridClass = getGridClass(cols);

	return (
		<div className='@container'>
			<div className={`grid ${gridClass} gap-4`}>
				{children.map((segment, i) => (
					<div key={i} className='min-w-0'>
						{segment.type === 'markdown' ? (
							<Streamdown mode='static'>{segment.content}</Streamdown>
						) : segment.type === 'chart' ? (
							renderChart(segment.chart, i)
						) : segment.type === 'grid' ? (
							<StoryGrid cols={segment.cols} children={segment.children} renderChart={renderChart} />
						) : null}
					</div>
				))}
			</div>
		</div>
	);
}
