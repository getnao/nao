import { cn } from '@/lib/utils';

export type SummarySegment =
	| { type: 'text'; content: string }
	| { type: 'chart'; chartType: string; title: string }
	| { type: 'table'; title: string }
	| { type: 'grid'; cols: number; children: SummarySegment[] };

export type StorySummary = {
	segments: SummarySegment[];
};

export function StoryThumbnail({ summary, className }: { summary: StorySummary; className?: string }) {
	return (
		<div className={cn('flex flex-col gap-1 w-full overflow-hidden', className)}>
			{summary.segments.map((seg, i) => (
				<ThumbnailSegment key={i} segment={seg} />
			))}
		</div>
	);
}

function ThumbnailSegment({ segment }: { segment: SummarySegment }) {
	switch (segment.type) {
		case 'text':
			return <TextBlock content={segment.content} />;
		case 'chart':
			return <MiniChart chartType={segment.chartType} title={segment.title} />;
		case 'table':
			return <MiniTable title={segment.title} />;
		case 'grid':
			return <GridBlock cols={segment.cols} children={segment.children} />;
	}
}

function TextBlock({ content }: { content: string }) {
	const lines = content.split('\n').filter((l) => l.length > 0);

	return (
		<div className='flex flex-col'>
			{lines.map((line, i) => {
				const headingMatch = line.match(/^(#{1,3})\s+(.*)/);
				if (headingMatch) {
					const level = headingMatch[1].length;
					return (
						<span
							key={i}
							className={cn(
								'truncate font-semibold text-foreground/70 leading-tight',
								level === 1 && 'text-[8px] mt-0.5 mb-px',
								level === 2 && 'text-[7px] mt-0.5 mb-px',
								level === 3 && 'text-[6.5px] mt-px',
							)}
						>
							{headingMatch[2]}
						</span>
					);
				}

				const isBold = line.startsWith('**') && line.endsWith('**');

				return (
					<span
						key={i}
						className={cn(
							'truncate text-[6px] leading-[1.4] text-foreground/40',
							isBold && 'font-medium text-foreground/55',
						)}
					>
						{isBold ? line.slice(2, -2) : line}
					</span>
				);
			})}
		</div>
	);
}

const CHART_STYLES: Record<string, { bg: string; stroke: string; fill: string }> = {
	bar: { bg: 'bg-blue-50 dark:bg-blue-950/40', stroke: '#3b82f6', fill: '#93c5fd' },
	stacked_bar: { bg: 'bg-indigo-50 dark:bg-indigo-950/40', stroke: '#6366f1', fill: '#a5b4fc' },
	line: { bg: 'bg-emerald-50 dark:bg-emerald-950/40', stroke: '#10b981', fill: '#6ee7b7' },
	area: { bg: 'bg-teal-50 dark:bg-teal-950/40', stroke: '#14b8a6', fill: '#5eead4' },
	pie: { bg: 'bg-amber-50 dark:bg-amber-950/40', stroke: '#f59e0b', fill: '#fcd34d' },
};

function MiniChart({ chartType, title }: { chartType: string; title: string }) {
	const style = CHART_STYLES[chartType] ?? CHART_STYLES.bar;

	return (
		<div className={cn('rounded border border-border/60 px-1.5 pt-1 pb-1', style.bg)}>
			{title && <span className='block text-[6px] font-medium text-foreground/50 truncate mb-0.5'>{title}</span>}
			<ChartSvg chartType={chartType} stroke={style.stroke} fill={style.fill} />
		</div>
	);
}

function ChartSvg({ chartType, stroke, fill }: { chartType: string; stroke: string; fill: string }) {
	const h = 24;
	const w = '100%';

	if (chartType === 'pie') {
		return (
			<svg viewBox='0 0 60 24' width={w} height={h} className='block'>
				<circle cx='30' cy='12' r='10' fill={fill} opacity={0.5} />
				<path d='M30 2 A10 10 0 0 1 38.66 17 L30 12 Z' fill={stroke} opacity={0.6} />
				<path d='M30 2 A10 10 0 0 0 21.34 17 L30 12 Z' fill={stroke} opacity={0.3} />
			</svg>
		);
	}

	if (chartType === 'line' || chartType === 'area') {
		const points = '2,20 12,14 22,16 32,8 42,10 52,4 58,6';
		return (
			<svg viewBox='0 0 60 24' width={w} height={h} className='block'>
				{chartType === 'area' && <polygon points={`2,22 ${points} 58,22`} fill={fill} opacity={0.3} />}
				<polyline points={points} fill='none' stroke={stroke} strokeWidth='1.5' opacity={0.6} />
			</svg>
		);
	}

	const bars = [14, 8, 18, 11, 20, 6, 15];
	const barW = 5;
	const gap = 3.3;
	return (
		<svg viewBox='0 0 60 24' width={w} height={h} className='block'>
			{bars.map((barH, i) => (
				<rect
					key={i}
					x={2 + i * (barW + gap)}
					y={22 - barH}
					width={barW}
					height={barH}
					rx={1}
					fill={i % 2 === 0 ? stroke : fill}
					opacity={i % 2 === 0 ? 0.55 : 0.45}
				/>
			))}
		</svg>
	);
}

function MiniTable({ title }: { title: string }) {
	return (
		<div className='rounded border border-border/60 bg-slate-50/70 px-1.5 pt-1 pb-1 dark:bg-slate-900/40'>
			{title ? (
				<span className='mb-0.5 block truncate text-[6px] font-medium text-foreground/50'>{title}</span>
			) : null}
			<TableSvg />
		</div>
	);
}

function TableSvg() {
	return (
		<svg viewBox='0 0 60 24' width='100%' height={24} className='block'>
			<rect x='1' y='2' width='58' height='20' rx='1.5' fill='#f8fafc' stroke='#cbd5e1' strokeWidth='0.8' />
			<rect x='1.5' y='2.5' width='57' height='4.5' fill='#e2e8f0' />
			<line x1='20' y1='2.5' x2='20' y2='22' stroke='#cbd5e1' strokeWidth='0.7' />
			<line x1='39' y1='2.5' x2='39' y2='22' stroke='#cbd5e1' strokeWidth='0.7' />
			<line x1='1' y1='10' x2='59' y2='10' stroke='#dbe3ed' strokeWidth='0.7' />
			<line x1='1' y1='14.5' x2='59' y2='14.5' stroke='#dbe3ed' strokeWidth='0.7' />
			<line x1='1' y1='19' x2='59' y2='19' stroke='#dbe3ed' strokeWidth='0.7' />
		</svg>
	);
}

function GridBlock({ cols, children }: { cols: number; children: SummarySegment[] }) {
	const gridCols = Math.min(cols, 3);
	return (
		<div className='grid gap-1' style={{ gridTemplateColumns: `repeat(${gridCols}, 1fr)` }}>
			{children.map((child, i) => (
				<ThumbnailSegment key={i} segment={child} />
			))}
		</div>
	);
}
