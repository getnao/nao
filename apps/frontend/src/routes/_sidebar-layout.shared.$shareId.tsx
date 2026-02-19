import { useMemo } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { useSuspenseQuery } from '@tanstack/react-query';
import { Streamdown } from 'streamdown';
import type { displayChart } from '@nao/shared/tools';
import type { ParsedChartBlock, Segment } from '@/lib/artifact-segments';
import { splitCodeIntoSegments } from '@/lib/artifact-segments';
import { ChartDisplay } from '@/components/tool-calls/display-chart';
import { Spinner } from '@/components/ui/spinner';
import { trpc } from '@/main';

export const Route = createFileRoute('/_sidebar-layout/shared/$shareId')({
	component: SharedArtifactPage,
});

function SharedArtifactPage() {
	const { shareId } = Route.useParams();

	const { data: artifact, isLoading } = useSuspenseQuery(trpc.sharedArtifact.get.queryOptions({ id: shareId }));

	if (isLoading) {
		return (
			<div className='flex flex-1 items-center justify-center'>
				<Spinner />
			</div>
		);
	}

	return (
		<div className='flex flex-col flex-1 h-full overflow-hidden bg-panel'>
			<header className='flex items-center gap-3 border-b px-6 py-4 shrink-0 bg-background'>
				<h1 className='text-base font-medium truncate'>{artifact.title}</h1>
			</header>

			<div className='flex-1 overflow-auto'>
				<div className='max-w-3xl mx-auto p-8 flex flex-col gap-4'>
					<SharedSegmentList
						code={artifact.code}
						queryData={artifact.queryData as Record<string, Record<string, unknown>[]> | null}
					/>
				</div>
			</div>
		</div>
	);
}

function SharedSegmentList({
	code,
	queryData,
}: {
	code: string;
	queryData: Record<string, Record<string, unknown>[]> | null;
}) {
	const segments = useMemo(() => splitCodeIntoSegments(code), [code]);

	return (
		<>
			{segments.map((segment, i) => (
				<SharedSegment key={i} segment={segment} queryData={queryData} />
			))}
		</>
	);
}

function SharedSegment({
	segment,
	queryData,
}: {
	segment: Segment;
	queryData: Record<string, Record<string, unknown>[]> | null;
}) {
	switch (segment.type) {
		case 'markdown':
			return <Streamdown mode='static'>{segment.content}</Streamdown>;
		case 'chart':
			return <SharedChartEmbed chart={segment.chart} queryData={queryData} />;
		case 'grid':
			return <SharedGrid cols={segment.cols} children={segment.children} queryData={queryData} />;
	}
}

const GRID_CLASSES: Record<number, string> = {
	1: 'grid-cols-1',
	2: 'grid-cols-1 @sm:grid-cols-2',
	3: 'grid-cols-1 @sm:grid-cols-2 @xl:grid-cols-3',
	4: 'grid-cols-1 @sm:grid-cols-2 @lg:grid-cols-3 @2xl:grid-cols-4',
};

function SharedGrid({
	cols,
	children,
	queryData,
}: {
	cols: number;
	children: Segment[];
	queryData: Record<string, Record<string, unknown>[]> | null;
}) {
	const gridClass = GRID_CLASSES[Math.min(cols, 4)] ?? GRID_CLASSES[2];

	return (
		<div className='@container'>
			<div className={`grid ${gridClass} gap-4`}>
				{children.map((segment, i) => (
					<div key={i} className='min-w-0'>
						<SharedSegment segment={segment} queryData={queryData} />
					</div>
				))}
			</div>
		</div>
	);
}

function SharedChartEmbed({
	chart,
	queryData,
}: {
	chart: ParsedChartBlock;
	queryData: Record<string, Record<string, unknown>[]> | null;
}) {
	const data = queryData?.[chart.queryId];

	if (!data || data.length === 0) {
		return (
			<div className='my-2 rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground'>
				Chart data unavailable
			</div>
		);
	}

	if (chart.series.length === 0) {
		return (
			<div className='my-2 rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground'>
				No series configured for chart
			</div>
		);
	}

	return (
		<div className='my-2 aspect-3/2'>
			<ChartDisplay
				data={data}
				chartType={chart.chartType as displayChart.ChartType}
				xAxisKey={chart.xAxisKey}
				xAxisType={chart.xAxisType === 'number' ? 'number' : 'category'}
				series={chart.series}
				title={chart.title}
			/>
		</div>
	);
}
