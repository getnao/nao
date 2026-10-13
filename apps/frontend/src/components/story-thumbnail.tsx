import { buildChart, formatChartValue } from '@nao/shared';
import { getGridTemplateColumns } from '@nao/shared/story-segments';
import type { ReactNode } from 'react';
import type { StorySummary, SummarySegment } from '@nao/shared/types';
import type { ChartType } from '@nao/shared/chart-types';
import type { StoryTheme } from '@nao/shared/story-theme';
import type { QueryDataMap } from '@/components/story-embeds';
import { ChartContainer } from '@/components/ui/chart';
import { StoryThemeProvider } from '@/components/story-theme-provider';
import { cn } from '@/lib/utils';

export const SHEET_VISUAL = `rounded-[2px]
	 shadow-[-20px_26px_52px_-18px_rgba(17,17,40,0.13),-8px_8px_18px_-10px_rgba(17,17,40,0.06)]
	 dark:shadow-[-14px_18px_34px_-22px_rgba(255,255,255,0.02),-6px_6px_14px_-12px_rgba(255,255,255,0.012)]
`;

export const SHEET_TRANSFORM = 'perspective(400px) rotateX(30deg) rotateY(20deg) rotateZ(-20deg)';

export const SHEET_SURFACE = 'bg-gradient-to-b from-background to-background/90';

export function PaperSheet({
	children,
	className,
	isToolPart = false,
	theme,
}: {
	children: ReactNode;
	className?: string;
	isToolPart?: boolean;
	theme?: StoryTheme | null;
}) {
	return (
		<div className={cn('absolute inset-0', className)}>
			<StoryThemeProvider theme={theme ?? null} className='relative'>
				<div
					className={cn(
						'absolute left-[15%] w-[130%] h-[200%] origin-top-left bg-secondary',
						isToolPart ? 'top-[23%]' : 'top-[27%]',
						SHEET_VISUAL,
					)}
					style={{ transform: SHEET_TRANSFORM }}
				/>
				<div
					className={cn(
						'absolute left-[16%] w-[130%] h-[200%] origin-top-left',
						isToolPart ? 'top-[22%]' : 'top-[26%]',
						SHEET_SURFACE,
						'rounded-[2px]',
						isToolPart ? 'border-t border-r' : 'pr-5',
					)}
					style={{ transform: SHEET_TRANSFORM }}
				>
					<div className='flex flex-col gap-[7px] p-[7%]'>{children}</div>
				</div>
			</StoryThemeProvider>
		</div>
	);
}

export function StoryThumbnail({
	summary,
	className,
	isToolPart = false,
	theme,
	queryData,
}: {
	summary: StorySummary;
	className?: string;
	isToolPart?: boolean;
	theme?: StoryTheme | null;
	queryData?: QueryDataMap | null;
}) {
	const segments = summary.segments.slice(0, 6);

	if (!isToolPart) {
		return (
			<FlatStorySheet className={className} theme={theme}>
				{segments.map((seg, i) => (
					<SegmentSilhouette key={i} segment={seg} variant='flat' queryData={queryData} />
				))}
			</FlatStorySheet>
		);
	}

	return (
		<PaperSheet className={className} isToolPart={isToolPart} theme={theme}>
			{segments.map((seg, i) => (
				<SegmentSilhouette key={i} segment={seg} variant='mini' queryData={queryData} />
			))}
		</PaperSheet>
	);
}

function FlatStorySheet({
	children,
	className,
	theme,
}: {
	children: ReactNode;
	className?: string;
	theme?: StoryTheme | null;
}) {
	return (
		<div className={cn('absolute inset-0 overflow-hidden bg-background', className)}>
			<StoryThemeProvider
				theme={theme ?? null}
				className='relative overflow-hidden bg-background text-foreground'
			>
				<div className='absolute top-0 left-0 flex w-[480px] origin-top-left scale-[0.42] flex-col gap-4 bg-background px-6 py-2'>
					{children}
				</div>
			</StoryThemeProvider>
		</div>
	);
}

export function FolderThumbnail({ theme }: { theme?: StoryTheme | null } = {}) {
	return (
		<div className='pointer-events-none absolute inset-0 overflow-hidden'>
			<StoryThemeProvider theme={theme ?? null} className='relative overflow-hidden text-foreground'>
				<div
					className={cn(
						'absolute top-[41%] left-[11%] w-[130%] h-[200%] origin-top-left bg-secondary',
						SHEET_VISUAL,
					)}
					style={{ transform: SHEET_TRANSFORM }}
				>
					<div className='absolute -top-[5%] left-[5%] h-[9%] w-[32%] rounded-t-[3px] bg-secondary' />
				</div>

				<div
					className={cn(
						'pr-5 absolute top-[24%] left-[12%] w-[140%] h-[200%] origin-top-left bg-secondary',
						SHEET_VISUAL,
					)}
					style={{ transform: SHEET_TRANSFORM }}
				/>

				<div
					className={cn(
						'pr-5 absolute top-[23%] left-[13%] w-[140%] h-[200%] origin-top-left',
						SHEET_SURFACE,
						SHEET_VISUAL,
					)}
					style={{ transform: SHEET_TRANSFORM }}
				/>

				<div
					className='absolute top-[40%] left-[12%] w-[50%] h-[200%] origin-top-left rounded-[2px] rounded-b-none bg-sidebar dark:bg-background'
					style={{ transform: SHEET_TRANSFORM }}
				>
					<div
						className='pointer-events-none absolute inset-0 rounded-[2px] rounded-b-none border-t-2 border-r-2 border-primary'
						style={{
							maskImage: 'linear-gradient(to top right, transparent 20%, black 78%)',
							WebkitMaskImage: 'linear-gradient(to top right, transparent 20%, black 78%)',
						}}
					/>
				</div>

				<div
					className='absolute top-[35%] left-[52.5%] w-[70%] h-[200%] origin-top-left rounded-[2px] rounded-tl-none bg-sidebar dark:bg-background'
					style={{ transform: `${SHEET_TRANSFORM} rotateY(-1.5deg)` }}
				>
					<div
						className='pointer-events-none absolute inset-0 rounded-[2px] rounded-tl-none border-t-2 border-primary'
						style={{
							maskImage: 'linear-gradient(to left, transparent 8%, black 70%)',
							WebkitMaskImage: 'linear-gradient(to left, transparent 8%, black 70%)',
						}}
					/>
				</div>
			</StoryThemeProvider>
		</div>
	);
}

type ThumbnailVariant = 'flat' | 'mini';

function SegmentSilhouette({
	segment,
	variant,
	queryData,
}: {
	segment: SummarySegment;
	variant: ThumbnailVariant;
	queryData?: QueryDataMap | null;
}) {
	switch (segment.type) {
		case 'text':
			return <TextBlock content={segment.content} variant={variant} />;
		case 'chart':
			return (
				<MiniChart
					chartType={segment.chartType}
					title={segment.title}
					kpiCount={segment.kpiCount}
					colors={segment.colors}
					variant={variant}
					queryId={segment.queryId}
					series={segment.series}
					queryData={queryData}
				/>
			);
		case 'table':
			return <MiniTable title={segment.title} variant={variant} />;
		case 'map':
			return <MiniMap title={segment.title} color={segment.color} variant={variant} />;
		case 'grid':
			return (
				<GridSilhouette
					cols={segment.cols}
					widths={segment.widths}
					children={segment.children}
					variant={variant}
					queryData={queryData}
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
					'truncate font-semibold leading-tight text-foreground/85',
					variant === 'flat' && level === 1 && 'mb-1 text-[15px]',
					variant === 'flat' && level === 2 && 'mb-1 text-[13px]',
					variant === 'flat' && level === 3 && 'text-[12px]',
					variant === 'mini' && level === 1 && 'text-[5.75px] mb-px',
					variant === 'mini' && level === 2 && 'text-[5.25px] mb-px',
					variant === 'mini' && level === 3 && 'text-[4.75px]',
				)}
			>
				{headingMatch[2]}
			</span>
		);
	}

	if (/^-{3,}$/.test(line)) {
		return (
			<div
				key={key}
				className={cn(variant === 'flat' ? 'my-2 h-px bg-foreground/25' : 'my-[0.5px] h-px bg-foreground/12')}
			/>
		);
	}

	const bulletMatch = line.match(/^[-*]\s+(.+)/);
	if (bulletMatch) {
		return (
			<span key={key} className={cn('flex min-w-0 items-start gap-1.5 text-foreground/65', textSize(variant))}>
				<span
					className={cn(
						'shrink-0 rounded-full bg-foreground/45',
						variant === 'flat' ? 'mt-[6px] size-[2.5px]' : 'mt-[2.5px] size-[1.25px]',
					)}
				/>
				<span className='min-w-0 truncate'>
					<InlineMarkdown text={bulletMatch[1]} />
				</span>
			</span>
		);
	}

	return (
		<span key={key} className={cn('truncate text-foreground/65', textSize(variant))}>
			<InlineMarkdown text={line} />
		</span>
	);
}

function textSize(variant: ThumbnailVariant): string {
	return variant === 'flat' ? 'text-[11.5px] leading-[15px]' : 'text-[4.75px] leading-[1.2]';
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
						className={cn('flex-1 truncate px-1 font-medium text-foreground/75', textSize(variant))}
					>
						<InlineMarkdown text={cell} />
					</span>
				))}
			</div>
			{visibleBody.map((row, i) => (
				<div key={i} className={cn('flex', i % 2 === 1 && 'bg-foreground/[0.025]')}>
					{row.slice(0, 3).map((cell, j) => (
						<span key={j} className={cn('flex-1 truncate px-1 text-foreground/60', textSize(variant))}>
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
					<strong key={i} className='font-medium text-foreground/80'>
						{part.slice(2, -2)}
					</strong>
				) : (
					part
				),
			)}
		</>
	);
}

const KPI_COLOR = 'bg-primary/50';
const DEFAULT_CHART_COLORS = Array.from({ length: 11 }, (_, i) => `var(--chart-${i + 1})`);

type KpiPreviewValue = {
	label: string;
	value: string;
};

type KpiPreviewSeries = NonNullable<Extract<SummarySegment, { type: 'chart' }>['series']>;

function KpiSilhouette({
	count,
	colors,
	values,
	variant,
}: {
	count: number;
	colors: string[];
	values: KpiPreviewValue[] | null;
	variant: ThumbnailVariant;
}) {
	if (values && values.length > 0) {
		const visibleValues = values.slice(0, Math.min(Math.max(count, 1), 4));
		if (variant === 'flat') {
			return (
				<div className='flex w-full flex-wrap justify-start'>
					{visibleValues.map((item, i) => (
						<div key={`${item.label}-${i}`} className='w-[104px] min-w-0'>
							<div className='flex items-center'>
								<div className='truncate text-[8px] leading-[9px] tracking-wide text-foreground/70'>
									{item.label}
								</div>
							</div>
							<div className='truncate text-[12px] leading-[13px] font-semibold tabular-nums text-foreground'>
								{item.value}
							</div>
						</div>
					))}
				</div>
			);
		}

		return (
			<div className={cn('grid', visibleValues.length > 1 ? 'grid-cols-2' : 'grid-cols-1', 'gap-[2px]')}>
				{visibleValues.map((item, i) => (
					<div key={`${item.label}-${i}`} className='min-w-0'>
						<div className='truncate text-[3.75px] leading-[1.1] text-foreground/55'>{item.label}</div>
						<div className='truncate text-[5px] leading-[1.05] font-semibold tabular-nums text-foreground'>
							{item.value}
						</div>
					</div>
				))}
			</div>
		);
	}

	const cards = Math.min(Math.max(count, 1), 4);
	if (variant === 'flat') {
		return (
			<div className='flex w-full flex-wrap justify-start'>
				{Array.from({ length: cards }).map((_, i) => (
					<div key={i} className='flex w-[104px] min-w-0 flex-col gap-2'>
						<div
							className={cn('h-1 w-[72px] rounded-full', colors.length === 0 && KPI_COLOR)}
							style={{ backgroundColor: colorAt(colors, i) }}
						/>
					</div>
				))}
			</div>
		);
	}

	return (
		<div className='flex gap-[9%]'>
			{Array.from({ length: cards }).map((_, i) => (
				<div key={i} className='flex w-[18%] flex-col gap-[5px]'>
					<div
						className={cn('h-[3px] w-full rounded-[2px]', colors.length === 0 && KPI_COLOR)}
						style={{ backgroundColor: colorAt(colors, i) }}
					/>
				</div>
			))}
		</div>
	);
}

function MiniChart({
	chartType,
	title,
	kpiCount,
	colors = [],
	variant,
	queryId,
	series,
	queryData,
}: {
	chartType: string;
	title: string;
	kpiCount?: number;
	colors?: string[];
	variant: ThumbnailVariant;
	queryId?: string;
	series?: KpiPreviewSeries;
	queryData?: QueryDataMap | null;
}) {
	const kpiValues = chartType === 'kpi_card' ? getKpiPreviewValues({ queryData, queryId, series }) : null;

	return (
		<PreviewBlock title={chartType === 'kpi_card' ? '' : title} variant={variant}>
			{chartType === 'kpi_card' ? (
				<KpiSilhouette count={kpiCount ?? 1} colors={colors} values={kpiValues} variant={variant} />
			) : (
				<RechartsThumbnail chartType={chartType} colors={colors} variant={variant} />
			)}
		</PreviewBlock>
	);
}

function getKpiPreviewValues({
	queryData,
	queryId,
	series,
}: {
	queryData?: QueryDataMap | null;
	queryId?: string;
	series?: KpiPreviewSeries;
}): KpiPreviewValue[] | null {
	if (!queryData || !queryId || !series || series.length === 0) {
		return null;
	}
	const latestRow = queryData[queryId]?.data.at(-1);
	if (!latestRow) {
		return null;
	}
	const values = series.flatMap((item) => {
		const label = item.label ?? item.dataKey;
		const rawValue = latestRow[item.dataKey];
		if (typeof rawValue === 'number') {
			return [{ label, value: formatChartValue(rawValue, item.valueFormat, { compact: true }) }];
		}
		if (typeof rawValue === 'string' && rawValue.trim() !== '') {
			return [{ label, value: rawValue }];
		}
		return [];
	});
	return values.length > 0 ? values : null;
}

function PreviewBlock({ title, children, variant }: { title: string; children: ReactNode; variant: ThumbnailVariant }) {
	return (
		<div
			className={cn('min-h-0 overflow-hidden border-solid bg-card', variant === 'flat' ? 'p-3' : 'p-[3px]')}
			style={{
				borderColor: 'var(--border)',
				borderRadius: thumbnailBlockRadius(variant),
				borderWidth: 'var(--story-block-border-width, 0px)',
			}}
		>
			{title && (
				<span
					className={cn(
						'block truncate font-medium text-foreground/70',
						variant === 'flat' ? 'mb-2 text-[12px]' : 'mb-0.5 text-[5px]',
					)}
				>
					{title}
				</span>
			)}
			{children}
		</div>
	);
}

function thumbnailBlockRadius(variant: ThumbnailVariant): string {
	const scale = variant === 'flat' ? 0.5 : 0.25;
	return `calc(var(--story-block-radius, var(--radius)) * ${scale})`;
}

function colorAt(colors: string[], index: number): string {
	return colors[index % colors.length] ?? DEFAULT_CHART_COLORS[index % DEFAULT_CHART_COLORS.length];
}

function RechartsThumbnail({
	chartType,
	colors,
	variant,
}: {
	chartType: string;
	colors: string[];
	variant: ThumbnailVariant;
}) {
	const { data, series, xAxisKey } = thumbnailChartData(chartType, colors);
	const config = Object.fromEntries(
		series.map((item, i) => [item.data_key, { label: item.label, color: colorAt(colors, i) }]),
	);
	const chart = buildChart({
		data,
		chartType: chartType as ChartType,
		xAxisKey,
		xAxisType: 'category',
		series,
		colorFor: (_key, i) => colorAt(colors, i),
		showGrid: false,
		renderTitle: false,
		hideAxes: true,
		showDataLabels: false,
		animate: false,
		margin: { top: 0, right: 0, bottom: 0, left: 0 },
		backgroundColor: 'var(--background)',
	});

	return (
		<ChartContainer
			config={config}
			className='pointer-events-none'
			contentClassName={cn('aspect-auto', variant === 'flat' ? 'h-[150px]' : 'h-[40px]')}
		>
			{chart}
		</ChartContainer>
	);
}

function thumbnailChartData(chartType: string, colors: string[]) {
	if (chartType === 'pie' || chartType === 'donut') {
		return {
			xAxisKey: 'x',
			series: [{ data_key: 's0', label: 'Value', color: colorAt(colors, 0) }],
			data: [
				{ x: 'A', s0: 42 },
				{ x: 'B', s0: 28 },
				{ x: 'C', s0: 18 },
				{ x: 'D', s0: 12 },
			],
		};
	}

	const seriesCount = chartType === 'mixed' || chartType.includes('stacked') ? Math.max(colors.length, 2) : 1;
	const series = Array.from({ length: Math.min(seriesCount, 3) }, (_, i) => ({
		data_key: `s${i}`,
		label: `Series ${i + 1}`,
		color: colorAt(colors, i),
		...(chartType === 'mixed' && i % 2 === 1 ? { series_type: 'line' as const } : {}),
	}));
	const values = [
		[18, 32, 24, 46, 38, 55],
		[12, 18, 28, 24, 34, 30],
		[8, 14, 11, 19, 16, 22],
	];

	return {
		xAxisKey: 'x',
		series,
		data: values[0].map((_, rowIndex) => ({
			x: `P${rowIndex + 1}`,
			...Object.fromEntries(
				series.map((item, seriesIndex) => [item.data_key, values[seriesIndex % values.length][rowIndex]]),
			),
		})),
	};
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
			<div className={cn(variant === 'flat' ? 'h-6' : 'h-[5px]', 'bg-current opacity-50 text-primary')} />
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

function MiniMap({ title, color, variant }: { title: string; color?: string; variant: ThumbnailVariant }) {
	return (
		<PreviewBlock title={title} variant={variant}>
			<MapSilhouette color={color} variant={variant} />
		</PreviewBlock>
	);
}

function MapSilhouette({ color = 'var(--chart-1)', variant }: { color?: string; variant: ThumbnailVariant }) {
	return (
		<div className='overflow-hidden rounded-[4px]'>
			<svg
				viewBox='0 0 60 36'
				width='100%'
				height='100%'
				className={cn('block', variant === 'flat' ? 'h-[150px]' : 'h-[26px]')}
				style={{ color }}
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
	queryData,
}: {
	cols: number;
	widths: number[] | null;
	children: SummarySegment[];
	variant: ThumbnailVariant;
	queryData?: QueryDataMap | null;
}) {
	const gridCols = Math.min(cols, 3);
	const gridTemplateColumns = widths !== null ? getGridTemplateColumns(widths) : `repeat(${gridCols}, 1fr)`;
	const visibleChildren = widths !== null ? children.slice(0, widths.length * 2) : children.slice(0, gridCols * 2);

	return (
		<div className={cn('grid', variant === 'flat' ? 'gap-4' : 'gap-[5px]')} style={{ gridTemplateColumns }}>
			{visibleChildren.map((child, i) => (
				<SegmentSilhouette key={i} segment={child} variant={variant} queryData={queryData} />
			))}
		</div>
	);
}
