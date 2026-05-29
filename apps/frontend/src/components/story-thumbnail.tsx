import type { StorySummary, SummarySegment } from '@nao/shared/types';
import { cn } from '@/lib/utils';

export function StoryThumbnail({ summary, className }: { summary: StorySummary; className?: string }) {
	const segments = summary.segments.slice(0, 4);

	return (
		<div className={cn('absolute inset-0 overflow-hidden', className)}>
			<div
				className='absolute top-[20%] left-[8%] w-[90%] h-[200%] origin-top-left bg-card
				           shadow-[0_8px_24px_-8px_rgba(0,0,0,0.18)] ring-1 ring-border rounded-xs'
				style={{ transform: 'perspective(900px) rotateX(12deg) rotateY(-8deg) rotateZ(-20deg)' }}
			>
				<div className='flex flex-col gap-[6px] p-[8%]'>
					{segments.map((seg, i) => (
						<SegmentSilhouette key={i} segment={seg} />
					))}
				</div>
			</div>
		</div>
	);
}

function SegmentSilhouette({ segment }: { segment: SummarySegment }) {
	switch (segment.type) {
		case 'text':
			return <TextLines />;
		case 'chart':
			return <ChartSilhouette chartType={segment.chartType} />;
		case 'table':
			return <TableSilhouette />;
		case 'grid':
			return <GridSilhouette cols={segment.cols} children={segment.children} />;
	}
}

function TextLines() {
	const widths = ['w-3/4', 'w-5/6', 'w-2/3', 'w-1/2', 'w-4/5'];
	return (
		<div className='flex flex-col gap-[3px]'>
			{widths.map((w, i) => (
				<div key={i} className={cn('h-[3px] rounded-full bg-foreground/15', w)} />
			))}
		</div>
	);
}

const BAR_HEIGHTS = [55, 35, 75, 48, 82, 28, 62];

function ChartSilhouette({ chartType }: { chartType: string }) {
	if (chartType === 'pie') {
		return (
			<svg viewBox='0 0 60 36' width='100%' height='100%' className='block max-h-[36px]'>
				<path
					d='M 30 5 A 13 13 0 0 1 38.87 27.5 L 34.77 23.12 A 7 7 0 0 0 30 11 Z'
					fill='var(--violet)'
					opacity={0.75}
					stroke='var(--card)'
					strokeWidth='0.8'
				/>
				<path
					d='M 38.87 27.5 A 13 13 0 0 1 19.48 25.64 L 24.34 22.12 A 7 7 0 0 0 34.77 23.12 Z'
					fill='var(--violet)'
					opacity={0.45}
					stroke='var(--card)'
					strokeWidth='0.8'
				/>
				<path
					d='M 19.48 25.64 A 13 13 0 0 1 19.48 10.36 L 24.34 13.88 A 7 7 0 0 0 24.34 22.12 Z'
					fill='var(--violet)'
					opacity={0.22}
					stroke='var(--card)'
					strokeWidth='0.8'
				/>
				<path
					d='M 19.48 10.36 A 13 13 0 0 1 30 5 L 30 11 A 7 7 0 0 0 24.34 13.88 Z'
					fill='var(--foreground)'
					opacity={0.08}
					stroke='var(--card)'
					strokeWidth='0.8'
				/>
				<circle cx='30' cy='18' r='7' fill='var(--card)' />
			</svg>
		);
	}

	if (chartType === 'line' || chartType === 'area') {
		const points = '2,32 10,22 20,26 30,12 40,16 50,6 58,10';
		return (
			<svg viewBox='0 0 60 36' width='100%' height='100%' className='block max-h-[36px]'>
				{chartType === 'area' && (
					<polygon points={`2,34 ${points} 58,34`} fill='var(--violet)' opacity={0.18} />
				)}
				<polyline
					points={points}
					fill='none'
					stroke='var(--violet)'
					strokeWidth='1.5'
					opacity={0.7}
					strokeLinejoin='round'
				/>
			</svg>
		);
	}

	const barW = 5.5;
	const gap = 3;
	return (
		<svg viewBox='0 0 60 36' width='100%' height='100%' className='block max-h-[36px]'>
			{BAR_HEIGHTS.map((h, i) => (
				<rect
					key={i}
					x={2 + i * (barW + gap)}
					y={34 - h * 0.4}
					width={barW}
					height={h * 0.4}
					rx={1}
					fill='var(--violet)'
					opacity={i % 2 === 0 ? 0.65 : 0.38}
				/>
			))}
		</svg>
	);
}

function TableSilhouette() {
	return (
		<div className='rounded-[2px] overflow-hidden ring-1 ring-foreground/12'>
			<div className='h-[6px] bg-[var(--violet)] opacity-70' />
			{[1, 2, 3].map((i) => (
				<div key={i} className='flex gap-px'>
					<div className='flex-1 h-[5px] bg-foreground/10' />
					<div className='w-px bg-foreground/12' />
					<div className='flex-1 h-[5px] bg-foreground/7' />
					<div className='w-px bg-foreground/12' />
					<div className='flex-1 h-[5px] bg-foreground/10' />
				</div>
			))}
		</div>
	);
}

function GridSilhouette({ cols, children }: { cols: number; children: SummarySegment[] }) {
	const gridCols = Math.min(cols, 3);
	return (
		<div className='grid gap-[4px]' style={{ gridTemplateColumns: `repeat(${gridCols}, 1fr)` }}>
			{children.slice(0, gridCols * 2).map((child, i) => (
				<SegmentSilhouette key={i} segment={child} />
			))}
		</div>
	);
}
