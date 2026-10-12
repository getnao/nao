import { useId } from 'react';
import { getGridTemplateColumns } from '@nao/shared/story-segments';
import type { ReactNode } from 'react';
import type { StorySummary, SummarySegment } from '@nao/shared/types';
import { cn } from '@/lib/utils';

export const SHEET_VISUAL = `rounded-sm
	 shadow-[-20px_26px_52px_-18px_rgba(17,17,40,0.13),-8px_8px_18px_-10px_rgba(17,17,40,0.06)]
	 dark:shadow-[-14px_18px_34px_-22px_rgba(255,255,255,0.02),-6px_6px_14px_-12px_rgba(255,255,255,0.012)]
`;

export const SHEET_TRANSFORM = 'perspective(400px) rotateX(30deg) rotateY(20deg) rotateZ(-20deg)';

export const SHEET_SURFACE =
	'bg-gradient-to-b from-card to-panel dark:from-[oklch(0.20_0.008_270)] dark:to-[oklch(0.17_0.006_270)] dark:to-[40%]';

export function PaperSheet({
	children,
	className,
	isToolPart = false,
}: {
	children: ReactNode;
	className?: string;
	isToolPart?: boolean;
}) {
	return (
		<div className={cn('absolute inset-0 overflow-hidden', className)}>
			<div
				className={cn(
					'absolute top-[27%] left-[15%] w-[130%] h-[200%] origin-top-left bg-secondary dark:bg-secondary/90',
					SHEET_VISUAL,
				)}
				style={{ transform: SHEET_TRANSFORM }}
			/>
			<div
				className={cn(
					'absolute top-[26%] left-[16%] w-[130%] h-[200%] origin-top-left',
					SHEET_SURFACE,
					SHEET_VISUAL,
					isToolPart ? 'border-t border-r' : 'pr-5',
				)}
				style={{ transform: SHEET_TRANSFORM }}
			>
				<div className='flex flex-col gap-[7px] p-[7%] w-[85%]'>{children}</div>
			</div>
		</div>
	);
}

export function StoryThumbnail({
	summary,
	className,
	isToolPart = false,
}: {
	summary: StorySummary;
	className?: string;
	isToolPart?: boolean;
}) {
	const segments = summary.segments.slice(0, 6);

	if (!isToolPart) {
		return (
			<FlatStorySheet className={className}>
				{segments.map((seg, i) => (
					<SegmentSilhouette key={i} segment={seg} variant='flat' />
				))}
			</FlatStorySheet>
		);
	}

	return (
		<PaperSheet className={className} isToolPart={isToolPart}>
			{segments.map((seg, i) => (
				<SegmentSilhouette key={i} segment={seg} variant='mini' />
			))}
		</PaperSheet>
	);
}

function FlatStorySheet({ children, className }: { children: ReactNode; className?: string }) {
	return (
		<div className={cn('absolute inset-0 overflow-hidden bg-background', className)}>
			<div className='absolute top-0 left-0 flex w-[480px] origin-top-left scale-[0.42] flex-col gap-4 bg-background px-6 py-2'>
				{children}
			</div>
		</div>
	);
}

const FOLDER_DOC_SEGMENTS: SummarySegment[] = [
	{ type: 'text', content: 'xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx' },
	{ type: 'chart', chartType: 'bar', title: 'xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx', kpiCount: 1 },
];

export function FolderThumbnail() {
	return (
		<div className='pointer-events-none absolute inset-0 overflow-hidden'>
			<div
				className={cn(
					'absolute top-[41%] left-[11%] w-[130%] h-[200%] origin-top-left bg-secondary dark:bg-sidebar',
					SHEET_VISUAL,
				)}
				style={{ transform: SHEET_TRANSFORM }}
			>
				<div className='absolute -top-[5%] left-[5%] h-[9%] w-[32%] rounded-t-[3px] bg-secondary dark:bg-sidebar' />
			</div>

			<div
				className={cn(
					'pr-5 absolute top-[24%] left-[12%] w-[140%] h-[200%] origin-top-left bg-secondary dark:bg-secondary/90',
					SHEET_VISUAL,
				)}
				style={{ transform: SHEET_TRANSFORM }}
			></div>

			<div
				className={cn(
					'pr-5 absolute top-[23%] left-[13%] w-[140%] h-[200%] origin-top-left bg-gradient-to-b from-card to-panel dark:from-[oklch(0.21_0.008_270)] dark:to-[oklch(0.17_0.006_270)] dark:to-[40%]',
					SHEET_VISUAL,
				)}
				style={{ transform: SHEET_TRANSFORM }}
			>
				<div className='flex flex-col gap-[7px] pl-2 w-[85%]'>
					<div className='pt-5'>
						<SegmentSilhouette segment={FOLDER_DOC_SEGMENTS[0]} variant='mini' />
					</div>
					<div className='absolute w-[85%] left-12 pt-2'>
						<SegmentSilhouette segment={FOLDER_DOC_SEGMENTS[1]} variant='mini' />
					</div>
				</div>
			</div>

			<div
				className={cn(
					'absolute top-[40%] left-[12%] w-[50%] h-[200%] origin-top-left bg-sidebar dark:bg-background rounded-sm rounded-b-none',
				)}
				style={{ transform: SHEET_TRANSFORM }}
			>
				<div
					className='pointer-events-none absolute inset-0 rounded-sm rounded-b-none border-t-2 border-r-2 border-primary'
					style={{
						maskImage: 'linear-gradient(to top right, transparent, black)',
						WebkitMaskImage: 'linear-gradient(to top right, transparent, black)',
					}}
				/>
			</div>

			<div
				className={cn(
					'absolute top-[35%] left-[52.5%] w-[70%] h-[200%] origin-top-left bg-sidebar dark:bg-background rounded-sm rounded-tl-none',
				)}
				style={{ transform: `${SHEET_TRANSFORM} rotateY(-1.5deg)` }}
			>
				<div
					className='pointer-events-none absolute inset-0 rounded-sm rounded-tl-none border-t-2 border-primary'
					style={{
						maskImage: 'linear-gradient(to left, transparent, black)',
						WebkitMaskImage: 'linear-gradient(to left, transparent, black)',
					}}
				/>
			</div>
		</div>
	);
}

type ThumbnailVariant = 'flat' | 'mini';

function SegmentSilhouette({ segment, variant }: { segment: SummarySegment; variant: ThumbnailVariant }) {
	switch (segment.type) {
		case 'text':
			return <TextBlock content={segment.content} variant={variant} />;
		case 'chart':
			return (
				<MiniChart
					chartType={segment.chartType}
					title={segment.title}
					kpiCount={segment.kpiCount}
					variant={variant}
				/>
			);
		case 'table':
			return <MiniTable title={segment.title} variant={variant} />;
		case 'map':
			return <MiniMap title={segment.title} variant={variant} />;
		case 'grid':
			return (
				<GridSilhouette
					cols={segment.cols}
					widths={segment.widths}
					children={segment.children}
					variant={variant}
				/>
			);
	}
}

function TextBlock({ content, variant }: { content: string; variant: ThumbnailVariant }) {
	const lines = content
		.split('\n')
		.map((line) => line.trim())
		.filter((line) => line.length > 0);

	return (
		<div className='min-h-0 overflow-hidden'>
			<div className='flex min-h-0 flex-col'>{renderMarkdownPreview(lines, variant)}</div>
		</div>
	);
}

function renderMarkdownPreview(lines: string[], variant: ThumbnailVariant): ReactNode[] {
	const nodes: ReactNode[] = [];
	for (let i = 0; i < lines.length && nodes.length < 5; i++) {
		const line = lines[i];
		const nextLine = lines[i + 1];

		if (isMarkdownTableStart(line, nextLine)) {
			const tableLines = [line];
			i += 2;
			while (i < lines.length && isMarkdownTableRow(lines[i])) {
				tableLines.push(lines[i]);
				i++;
			}
			i--;
			nodes.push(<MarkdownTablePreview key={i} lines={tableLines} variant={variant} />);
			continue;
		}

		const node = renderMarkdownLine(line, variant, i);
		if (node) {
			nodes.push(node);
		}
	}
	return nodes;
}

function renderMarkdownLine(line: string, variant: ThumbnailVariant, key: number): ReactNode {
	const headingMatch = line.match(/^(#{1,3})\s+(.*)/);
	if (headingMatch) {
		const level = headingMatch[1].length;
		return (
			<span
				key={key}
				className={cn(
					'truncate font-semibold leading-tight text-foreground/75',
					variant === 'flat' && level === 1 && 'mb-1 text-lg',
					variant === 'flat' && level === 2 && 'mb-1 text-base',
					variant === 'flat' && level === 3 && 'text-sm',
					variant === 'mini' && level === 1 && 'text-[8px] mb-px',
					variant === 'mini' && level === 2 && 'text-[7px] mb-px',
					variant === 'mini' && level === 3 && 'text-[6.5px]',
				)}
			>
				{headingMatch[2]}
			</span>
		);
	}

	if (/^-{3,}$/.test(line)) {
		return <div key={key} className={cn('bg-border', variant === 'flat' ? 'my-2 h-px' : 'my-px h-[1px]')} />;
	}

	const bulletMatch = line.match(/^[-*]\s+(.+)/);
	if (bulletMatch) {
		return (
			<span
				key={key}
				className={cn('flex min-w-0 items-start gap-1.5 text-muted-foreground/75', textSize(variant))}
			>
				<span
					className={cn(
						'shrink-0 rounded-full bg-foreground/45',
						variant === 'flat' ? 'mt-[7px] size-[3px]' : 'mt-[3px] size-[1.5px]',
					)}
				/>
				<span className='min-w-0 truncate'>
					<InlineMarkdown text={bulletMatch[1]} />
				</span>
			</span>
		);
	}

	return (
		<span key={key} className={cn('truncate text-muted-foreground/75', textSize(variant))}>
			<InlineMarkdown text={line} />
		</span>
	);
}

function textSize(variant: ThumbnailVariant): string {
	return variant === 'flat' ? 'text-[13px] leading-[18px]' : 'text-[6px] leading-[1.35]';
}

function MarkdownTablePreview({ lines, variant }: { lines: string[]; variant: ThumbnailVariant }) {
	const rows = lines.map(splitTableCells).filter((row) => row.length > 0);
	const [header, ...body] = rows;
	const visibleBody = body.slice(0, variant === 'flat' ? 3 : 2);

	return (
		<div
			className={cn(
				'overflow-hidden rounded-[4px] ring-1 ring-foreground/8',
				variant === 'flat' ? 'my-2' : 'my-px',
			)}
		>
			<div className='flex bg-foreground/6'>
				{header.slice(0, 3).map((cell, i) => (
					<span
						key={i}
						className={cn('flex-1 truncate px-1 font-medium text-foreground/55', textSize(variant))}
					>
						<InlineMarkdown text={cell} />
					</span>
				))}
			</div>
			{visibleBody.map((row, i) => (
				<div key={i} className={cn('flex', i % 2 === 1 && 'bg-foreground/[0.025]')}>
					{row.slice(0, 3).map((cell, j) => (
						<span
							key={j}
							className={cn('flex-1 truncate px-1 text-muted-foreground/70', textSize(variant))}
						>
							<InlineMarkdown text={cell} />
						</span>
					))}
				</div>
			))}
		</div>
	);
}

function isMarkdownTableStart(line: string, nextLine: string | undefined): nextLine is string {
	return isMarkdownTableRow(line) && nextLine !== undefined && isMarkdownTableSeparator(nextLine);
}

function isMarkdownTableRow(line: string): boolean {
	return line.includes('|') && /^\|?.+\|.+\|?$/.test(line);
}

function isMarkdownTableSeparator(line: string): boolean {
	return /^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?$/.test(line);
}

function splitTableCells(line: string): string[] {
	return line
		.replace(/^\|/, '')
		.replace(/\|$/, '')
		.split('|')
		.map((cell) => cell.trim());
}

function InlineMarkdown({ text }: { text: string }) {
	const parts = text.split(/(\*\*[^*]+\*\*)/g).filter(Boolean);
	return (
		<>
			{parts.map((part, i) =>
				part.startsWith('**') && part.endsWith('**') ? (
					<strong key={i} className='font-medium text-foreground/60'>
						{part.slice(2, -2)}
					</strong>
				) : (
					part
				),
			)}
		</>
	);
}

const CHART_COLOR = 'text-primary';
const KPI_COLOR = 'bg-primary/50';

const BAR_HEIGHTS = [0.61, 0.65, 0.3, 0.53, 0.3, 0.26, 0.53, 0.53, 0.65, 0.23, 0.61, 0.68, 0.81, 0.9, 0.81, 0.9];

const LINE_CHART_PATH =
	'M0.224902 75.5254L5.15102 79.2027L9.39896 79.877L17.7549 90.5551L22.1227 81.2849L23.881 72.4827L31.5661 77.3836L46.3255 79.7334L52.2967 75.2915L52.7928 69.5649L61.2699 71.915L69.5264 72.0967L70.5474 61.4031L74.2326 52.8176L77.6591 42.8168L86.5828 43.549L93.0734 41.2612L100.435 43.5633L106.496 37.6563L119.029 43.8047L119.238 32.9285L123.346 29.4689L124.819 17.2725L130.453 10.8518L137.174 7.9143L141.425 0.372686L147.885 -6.77523';

function KpiSilhouette({ count }: { count: number }) {
	const cards = Math.min(Math.max(count, 1), 4);
	return (
		<div className='flex gap-[9%]'>
			{Array.from({ length: cards }).map((_, i) => (
				<div key={i} className='flex w-[18%] flex-col gap-[5px]'>
					<div className={cn('h-[3px] w-full rounded-[2px]', KPI_COLOR)} />
				</div>
			))}
		</div>
	);
}

function MiniChart({
	chartType,
	title,
	kpiCount,
	variant,
}: {
	chartType: string;
	title: string;
	kpiCount?: number;
	variant: ThumbnailVariant;
}) {
	const lineGradientId = useId();
	const pieGradientId = useId();
	const barGradientId = useId();

	return (
		<PreviewBlock title={title} variant={variant}>
			{chartType === 'kpi_card' ? (
				<KpiSilhouette count={kpiCount ?? 1} />
			) : chartType === 'pie' ? (
				<PieChartSilhouette gradientId={pieGradientId} variant={variant} />
			) : chartType === 'line' || chartType === 'area' ? (
				<LineChartSilhouette chartType={chartType} gradientId={lineGradientId} variant={variant} />
			) : (
				<BarChartSilhouette gradientId={barGradientId} variant={variant} />
			)}
		</PreviewBlock>
	);
}

function PreviewBlock({ title, children, variant }: { title: string; children: ReactNode; variant: ThumbnailVariant }) {
	return (
		<div className='min-h-0 overflow-hidden bg-background'>
			{title && (
				<span
					className={cn(
						'block truncate font-medium text-foreground/55',
						variant === 'flat' ? 'mb-3 text-sm' : 'mb-1 text-[6.5px]',
					)}
				>
					{title}
				</span>
			)}
			{children}
		</div>
	);
}

function PieChartSilhouette({ gradientId, variant }: { gradientId: string; variant: ThumbnailVariant }) {
	return (
		<svg
			viewBox='-11 -8.67 55 43.34'
			width='100%'
			height='100%'
			fill='none'
			className={cn('block', variant === 'flat' ? 'h-[130px]' : 'max-h-[36px]', CHART_COLOR)}
		>
			<defs>
				<linearGradient id={gradientId} x1='29' y1='1' x2='1' y2='21' gradientUnits='userSpaceOnUse'>
					<stop stopColor='currentColor' stopOpacity={0.95} />
					<stop offset='1' stopColor='currentColor' stopOpacity={0.06} />
				</linearGradient>
			</defs>
			<path
				d='M28.7935 12.3195C30.6166 19.1233 26.3878 24.8382 19.3483 25.084C12.3087 25.3299 5.12408 20.0135 3.30099 13.2097C1.4779 6.40583 5.7067 0.690937 12.7463 0.44511C19.7858 0.199282 26.9705 5.51561 28.7935 12.3195ZM8.89851 13.0142C9.92099 16.8302 13.9505 19.8118 17.8986 19.6739C21.8468 19.5361 24.2185 16.3309 23.196 12.5149C22.1735 8.69899 18.1441 5.71732 14.1959 5.85519C10.2478 5.99307 7.87603 9.19827 8.89851 13.0142Z'
				fill='var(--foreground)'
				opacity={0.08}
			/>
			<path
				d='M25.5154 23.0408C23.7057 24.3875 21.3814 25.1014 18.8364 25.092C16.2913 25.0826 13.6398 24.3504 11.2173 22.9881C8.79465 21.6257 6.70973 19.6944 5.22614 17.4382C3.74256 15.1821 2.92693 12.7025 2.88241 10.3131C2.83789 7.92364 3.56647 5.73162 4.97603 4.01424C6.38558 2.29685 8.4128 1.13123 10.8013 0.664777C13.1898 0.198322 15.8324 0.451982 18.3948 1.39368C20.9572 2.33538 23.3244 3.92282 25.197 5.95526L21.1789 8.94557C20.1287 7.80567 18.801 6.91535 17.3639 6.3872C15.9268 5.85905 14.4447 5.71678 13.1051 5.9784C11.7655 6.24001 10.6285 6.89375 9.83796 7.85694C9.04741 8.82014 8.63878 10.0495 8.66375 11.3897C8.68872 12.7298 9.14616 14.1204 9.97823 15.3858C10.8103 16.6511 11.9796 17.7344 13.3383 18.4984C14.6971 19.2625 16.1841 19.6731 17.6115 19.6784C19.0389 19.6837 20.3425 19.2833 21.3575 18.528L25.5154 23.0408Z'
				fill={`url(#${gradientId})`}
			/>
		</svg>
	);
}

function LineChartSilhouette({
	chartType,
	gradientId,
	variant,
}: {
	chartType: string;
	gradientId: string;
	variant: ThumbnailVariant;
}) {
	return (
		<svg
			viewBox='0 0 149 91'
			width='100%'
			height='100%'
			className={cn('block', variant === 'flat' ? 'h-[160px]' : 'max-h-[40px]', CHART_COLOR)}
		>
			<defs>
				<linearGradient
					id={gradientId}
					x1='-5.02652'
					y1='72.4382'
					x2='154.447'
					y2='57.6661'
					gradientUnits='userSpaceOnUse'
				>
					<stop stopColor='currentColor' stopOpacity={0.06} />
					<stop offset='1' stopColor='currentColor' stopOpacity={0.95} />
				</linearGradient>
			</defs>
			{chartType === 'area' && (
				<path d={`${LINE_CHART_PATH}L147.885 91L0.224902 91Z`} fill='currentColor' opacity={0.1} />
			)}
			<path
				d={LINE_CHART_PATH}
				fill='none'
				stroke={`url(#${gradientId})`}
				strokeWidth='1.8'
				strokeLinejoin='round'
				strokeLinecap='round'
			/>
		</svg>
	);
}

function BarChartSilhouette({ gradientId, variant }: { gradientId: string; variant: ThumbnailVariant }) {
	const barW = 1.8;
	const gap = 2.2;
	return (
		<svg
			viewBox='0 0 60 36'
			width='100%'
			height='100%'
			className={cn('block', variant === 'flat' ? 'h-[150px]' : 'max-h-[40px]', CHART_COLOR)}
		>
			<defs>
				<linearGradient id={gradientId} x1='56' y1='2' x2='4' y2='34' gradientUnits='userSpaceOnUse'>
					<stop stopColor='currentColor' stopOpacity={0.95} />
					<stop offset='1' stopColor='currentColor' stopOpacity={0.06} />
				</linearGradient>
			</defs>
			{BAR_HEIGHTS.map((h, i) => {
				const height = h * 28;
				return (
					<rect
						key={i}
						x={2 + i * (barW + gap)}
						y={34 - height}
						width={barW}
						height={height}
						rx={0.9}
						fill={`url(#${gradientId})`}
					/>
				);
			})}
		</svg>
	);
}

function MiniTable({ title, variant }: { title: string; variant: ThumbnailVariant }) {
	return (
		<PreviewBlock title={title} variant={variant}>
			<TableSilhouette variant={variant} />
		</PreviewBlock>
	);
}

function TableSilhouette({ variant }: { variant: ThumbnailVariant }) {
	const rows = variant === 'flat' ? [0, 1, 2, 3, 4, 5] : [0, 1, 2];

	return (
		<div className='overflow-hidden rounded-[4px] ring-1 ring-foreground/8'>
			<div className={cn(variant === 'flat' ? 'h-6' : 'h-[5px]', 'bg-current opacity-50', CHART_COLOR)} />
			{rows.map((i) => (
				<div key={i} className={cn('flex gap-px', i % 2 === 1 && 'bg-foreground/[0.025]')}>
					<div className={cn('flex-1 bg-foreground/8', variant === 'flat' ? 'h-5' : 'h-[4px]')} />
					<div className='w-px bg-foreground/6' />
					<div className={cn('flex-1 bg-foreground/5', variant === 'flat' ? 'h-5' : 'h-[4px]')} />
					<div className='w-px bg-foreground/6' />
					<div className={cn('flex-1 bg-foreground/8', variant === 'flat' ? 'h-5' : 'h-[4px]')} />
				</div>
			))}
		</div>
	);
}

function MiniMap({ title, variant }: { title: string; variant: ThumbnailVariant }) {
	return (
		<PreviewBlock title={title} variant={variant}>
			<MapSilhouette variant={variant} />
		</PreviewBlock>
	);
}

function MapSilhouette({ variant }: { variant: ThumbnailVariant }) {
	return (
		<div className='overflow-hidden rounded-[4px]'>
			<svg
				viewBox='0 0 60 36'
				width='100%'
				height='100%'
				className={cn('block', variant === 'flat' ? 'h-[150px]' : 'max-h-[40px]', CHART_COLOR)}
			>
				<rect x='0' y='0' width='60' height='36' rx='4px' fill='currentColor' opacity={0.06} />
				<path
					d='M0 11L16 6L30 11L44 5L60 10'
					fill='none'
					stroke='var(--foreground)'
					strokeOpacity={0.1}
					strokeWidth='1'
				/>
				<path
					d='M0 24L14 20L28 25L42 19L60 24'
					fill='none'
					stroke='var(--foreground)'
					strokeOpacity={0.1}
					strokeWidth='1'
				/>
				<path
					d='M20 0L24 12L18 22L23 36'
					fill='none'
					stroke='var(--foreground)'
					strokeOpacity={0.1}
					strokeWidth='1'
				/>
				<path
					d='M42 0L38 14L44 24L40 36'
					fill='none'
					stroke='var(--foreground)'
					strokeOpacity={0.1}
					strokeWidth='1'
				/>
				<MapPin cx={19} cy={14} />
				<MapPin cx={38} cy={22} />
				<MapPin cx={47} cy={11} />
			</svg>
		</div>
	);
}

function MapPin({ cx, cy }: { cx: number; cy: number }) {
	return (
		<path
			d={`M${cx} ${cy - 4.2}C${cx - 1.56} ${cy - 4.2} ${cx - 2.64} ${cy - 3.12} ${cx - 2.64} ${cy - 1.68}C${cx - 2.64} ${cy - 0.12} ${cx} ${cy + 1.8} ${cx} ${cy + 1.8}C${cx} ${cy + 1.8} ${cx + 2.64} ${cy - 0.12} ${cx + 2.64} ${cy - 1.68}C${cx + 2.64} ${cy - 3.12} ${cx + 1.56} ${cy - 4.2} ${cx} ${cy - 4.2}Z`}
			fill='currentColor'
			opacity={0.85}
		/>
	);
}

function GridSilhouette({
	cols,
	widths,
	children,
	variant,
}: {
	cols: number;
	widths: number[] | null;
	children: SummarySegment[];
	variant: ThumbnailVariant;
}) {
	const gridCols = Math.min(cols, 3);
	const gridTemplateColumns = widths !== null ? getGridTemplateColumns(widths) : `repeat(${gridCols}, 1fr)`;
	const visibleChildren = widths !== null ? children.slice(0, widths.length * 2) : children.slice(0, gridCols * 2);

	return (
		<div className={cn('grid', variant === 'flat' ? 'gap-4' : 'gap-[5px]')} style={{ gridTemplateColumns }}>
			{visibleChildren.map((child, i) => (
				<SegmentSilhouette key={i} segment={child} variant={variant} />
			))}
		</div>
	);
}
