import { ChartColumn, ChartLine, ChartPie, Pencil } from 'lucide-react';
import type { CSSProperties, ReactNode } from 'react';
import { SHEET_SURFACE, SHEET_TRANSFORM, SHEET_VISUAL } from '@/components/story-thumbnail';
import { cn } from '@/lib/utils';

const ANIMATED = 'app-preview-animated';

const BAR_HEIGHTS = [0.61, 0.65, 0.3, 0.53, 0.3, 0.26, 0.53, 0.53, 0.65, 0.23, 0.61, 0.68, 0.81, 0.9, 0.81, 0.9];
const HOVERED_BAR_INDEX = 10;
const TEXT_LINE_WIDTHS = ['96%', '88%', '92%', '58%'];

const LINE_CHART_PATH =
	'M2.5 13L9.5 12L16.5 24L23.5 16L30.5 24L37.5 25L44.5 16L51.5 16L58.5 12L65.5 26L72.5 13L79.5 11L86.5 6L93.5 3L100.5 6L107.5 3';
const SPARKLINE_PATH = 'M2 20L9 15L16 17L23 9L30 12L37 5L44 7';
const POINTER_PATH = 'M4 3l6.5 17 2.4-7.1L20 10.5z';

/** Screen-space projection of the 12px block shift through SHEET_TRANSFORM, so overlays keep tracking the blocks. */
const BLOCKS_SHIFT_ON_SCREEN = 'translate(-8.2px, 1.7px)';

const CLICKS = [
	{ x: 112.9, y: 24.2, atSeconds: 0.6 },
	{ x: 136.9, y: 20.1, atSeconds: 3.3 },
	{ x: 182.2, y: 22.6, atSeconds: 6.2 },
	{ x: 68.4, y: 39.8, atSeconds: 7.3 },
	{ x: 94.5, y: 71, atSeconds: 8.4 },
	{ x: 159.3, y: 16.3, atSeconds: 9.3 },
];

export function CustomStoryThumbnail({ isToolPart = false }: { isToolPart?: boolean }) {
	return (
		<div className='custom-story-thumbnail pointer-events-none absolute inset-0'>
			<div
				className={cn(
					'absolute top-0 left-0 h-[88px] w-[210px]',
					isToolPart && '-left-[9px] origin-top-left scale-[0.73]',
				)}
			>
				<AppSheet isToolPart={isToolPart} />
				<div
					className='absolute inset-0'
					style={isToolPart ? { transform: BLOCKS_SHIFT_ON_SCREEN } : undefined}
				>
					<BarTooltip />
					{CLICKS.map((click) => (
						<ClickRipple key={click.atSeconds} {...click} />
					))}
					<Pointer />
				</div>
			</div>
		</div>
	);
}

function AppSheet({ isToolPart }: { isToolPart: boolean }) {
	const sheetSize = isToolPart ? 'h-[150px] w-[196px]' : 'h-[400px] w-[480px]';

	return (
		<>
			<div
				className={cn(
					'absolute top-[27%] left-[15%] origin-top-left bg-secondary dark:bg-secondary/90',
					sheetSize,
					SHEET_VISUAL,
				)}
				style={{ transform: SHEET_TRANSFORM }}
			/>
			<div
				className={cn(
					'absolute top-[26%] left-[16%] origin-top-left overflow-hidden',
					sheetSize,
					SHEET_SURFACE,
					SHEET_VISUAL,
					isToolPart && 'border-t border-r',
				)}
				style={{ transform: SHEET_TRANSFORM }}
			>
				<BlockEditPanel isToolPart={isToolPart} />
				<StoryTitle isToolPart={isToolPart} />
				<StoryTabs isToolPart={isToolPart} />
				<TextBlock isToolPart={isToolPart} />
				<ChartBlock isToolPart={isToolPart} />
				<InsightsBlock isToolPart={isToolPart} />
			</div>
		</>
	);
}

function BlockEditPanel({ isToolPart }: { isToolPart: boolean }) {
	return (
		<div
			className={cn(
				'absolute top-0 left-0 h-full border-r border-foreground/6 bg-foreground/6',
				isToolPart ? 'w-[52px]' : 'w-16',
			)}
		>
			<div
				className={cn(
					'absolute top-0 left-0 h-full w-16',
					isToolPart && 'origin-top-left scale-[0.8]',
					ANIMATED,
				)}
				style={animation('app-preview-edit-panel')}
			>
				<div className='absolute top-1.5 left-1.5 h-[3px] w-[26px] rounded-[1px] bg-foreground/55' />
				<div
					className={cn('absolute top-1.5 left-1.5 h-[3px] w-[26px] rounded-[1px] bg-primary', ANIMATED)}
					style={animation('app-preview-editing')}
				/>
				<div className='absolute top-3 left-1.5 h-[1.5px] w-11 rounded-[1px] bg-foreground/12' />
				<ChartTypeTile left={6} icon={ChartColumn} selectedAnimation='app-preview-tile-bar' />
				<ChartTypeTile left={23} icon={ChartLine} selectedAnimation='app-preview-tile-line' />
				<ChartTypeTile left={40} icon={ChartPie} />
				<div className='absolute top-8 left-1.5 flex h-2 w-12 items-center rounded-[2px] border border-foreground/12 px-[3px]'>
					<div className='h-[1.5px] w-5 bg-foreground/12' />
				</div>
				<ColorSwatches />
				<div className='absolute top-[57px] left-1.5 flex h-[9px] w-[22px] items-center justify-center rounded-[3px] border border-foreground/12'>
					<div className='h-[1.5px] w-2.5 bg-foreground/12' />
				</div>
				<div className='absolute top-[57px] left-8 flex h-[9px] w-[26px] items-center justify-center rounded-[3px] bg-primary'>
					<div className='h-[1.5px] w-3 bg-primary-foreground/90' />
				</div>
			</div>
		</div>
	);
}

function ChartTypeTile({
	left,
	icon: Icon,
	selectedAnimation,
}: {
	left: number;
	icon: typeof ChartColumn;
	selectedAnimation?: string;
}) {
	return (
		<div
			className='absolute top-[18px] flex h-2.5 w-3.5 items-center justify-center rounded-[2px] border border-foreground/12'
			style={{ left }}
		>
			<Icon className='size-[7px] text-foreground/25' strokeWidth={3} />
			{selectedAnimation && (
				<div
					className={cn(
						'absolute -inset-px flex items-center justify-center rounded-[2px] border border-primary bg-primary/10',
						ANIMATED,
					)}
					style={animation(selectedAnimation)}
				>
					<Icon className='size-[7px] text-primary' strokeWidth={3} />
				</div>
			)}
		</div>
	);
}

function ColorSwatches() {
	return (
		<div className='absolute top-[45px] left-1.5 flex gap-[3px]'>
			<div className='size-1.5 rounded-full bg-primary ring-1 ring-primary ring-offset-1 ring-offset-card' />
			<div className='size-1.5 rounded-full bg-primary/55' />
			<div className='size-1.5 rounded-full bg-primary/35' />
			<div className='size-1.5 rounded-full bg-primary/18' />
		</div>
	);
}

function StoryTitle({ isToolPart }: { isToolPart: boolean }) {
	return (
		<div
			className={cn(
				'absolute top-[3px] h-[3px] w-[52px] rounded-[1px] bg-foreground/55',
				isToolPart ? 'left-16' : 'left-[76px]',
			)}
		/>
	);
}

function StoryTabs({ isToolPart }: { isToolPart: boolean }) {
	const firstTabLeft = isToolPart ? 30 : 42;

	return (
		<>
			{[1, 2, 3].map((tab) => (
				<div
					key={tab}
					className='absolute top-2.5 flex h-[9px] w-7 items-center justify-center rounded-[4px] border border-foreground/12'
					style={{ left: firstTabLeft + 34 * tab }}
				>
					<div className='h-[1.5px] w-3.5 rounded-[1px] bg-foreground/12' />
					<div
						className={cn(
							'absolute -inset-px flex items-center justify-center rounded-[4px] border border-primary bg-primary/18',
							ANIMATED,
						)}
						style={animation(`app-preview-tab-${tab}`)}
					>
						<div className='h-[1.5px] w-3.5 rounded-[1px] bg-primary' />
					</div>
				</div>
			))}
		</>
	);
}

function TextBlock({ isToolPart }: { isToolPart: boolean }) {
	return (
		<StoryBlock tab={1} isToolPart={isToolPart} className='w-[114px]'>
			<div className='flex flex-col gap-[5px] pt-0.5 pr-2.5'>
				<TypedLine className='h-[3px] w-[45%] bg-primary' delaySeconds={0} />
				{TEXT_LINE_WIDTHS.map((width, index) => (
					<TypedLine
						key={width}
						className='h-[1.5px] bg-foreground/12'
						style={{ width }}
						delaySeconds={0.12 * (index + 1)}
					/>
				))}
			</div>
			<BlockPencil className='-top-1 left-[110px]' />
		</StoryBlock>
	);
}

function TypedLine({
	className,
	style,
	delaySeconds,
}: {
	className: string;
	style?: CSSProperties;
	delaySeconds: number;
}) {
	return (
		<div
			className={cn('origin-left rounded-[1px]', className, ANIMATED)}
			style={{ ...style, ...animation('app-preview-type', delaySeconds) }}
		/>
	);
}

function ChartBlock({ isToolPart }: { isToolPart: boolean }) {
	return (
		<StoryBlock tab={2} isToolPart={isToolPart} className='w-28'>
			<div
				className={cn('absolute inset-0 flex items-end gap-[2px]', ANIMATED)}
				style={animation('app-preview-chart-bars')}
			>
				{BAR_HEIGHTS.map((height, index) => (
					<ChartBar
						key={index}
						height={height}
						delaySeconds={index * 0.03}
						isHovered={index === HOVERED_BAR_INDEX}
					/>
				))}
			</div>
			<svg
				viewBox='0 0 112 34'
				className={cn('absolute inset-0 size-full overflow-visible', ANIMATED)}
				style={animation('app-preview-chart-line')}
			>
				<path d={`${LINE_CHART_PATH}L107.5 34L2.5 34Z`} className='fill-primary/10' />
				<path
					d={LINE_CHART_PATH}
					pathLength={100}
					strokeDasharray={100}
					className={cn('fill-none stroke-primary', ANIMATED)}
					strokeWidth={1.6}
					strokeLinejoin='round'
					strokeLinecap='round'
					style={animation('app-preview-line-draw')}
				/>
			</svg>
			<div
				className={cn(
					'absolute -inset-[3px] rounded-[3px] border border-primary shadow-[0_0_0_2px] shadow-primary/10',
					ANIMATED,
				)}
				style={animation('app-preview-editing')}
			/>
			<BlockPencil className='-top-1 left-[108px]' />
		</StoryBlock>
	);
}

function ChartBar({ height, delaySeconds, isHovered }: { height: number; delaySeconds: number; isHovered: boolean }) {
	return (
		<div
			className={cn('relative w-[5px] shrink-0 origin-bottom rounded-[1px] bg-primary/35', ANIMATED)}
			style={{ height: `${height * 100}%`, ...animation('app-preview-grow', delaySeconds) }}
		>
			{isHovered && (
				<div
					className={cn('absolute inset-0 rounded-[1px] bg-primary', ANIMATED)}
					style={animation('app-preview-hover')}
				/>
			)}
		</div>
	);
}

function InsightsBlock({ isToolPart }: { isToolPart: boolean }) {
	return (
		<StoryBlock tab={3} isToolPart={isToolPart} className='w-[140px]'>
			<div
				className={cn('absolute top-[3px] left-0', isToolPart ? 'h-6 w-8' : 'h-7 w-11', ANIMATED)}
				style={animation('app-preview-insight-pop')}
			>
				<div className='flex size-full flex-col gap-1 rounded-[3px] bg-primary/10 p-[5px]'>
					<div
						className={cn('h-[5px] w-[62%] origin-left rounded-[1px] bg-primary/80', ANIMATED)}
						style={animation('app-preview-kpi-fill')}
					/>
					<div className='h-[1.5px] w-4/5 bg-foreground/12' />
				</div>
				<BlockPencil className={cn('-top-1', isToolPart ? 'left-7' : 'left-10')} />
			</div>
			<div className={cn('absolute top-[3px] size-7', isToolPart ? 'left-[38px]' : 'left-[52px]')}>
				<svg viewBox='0 0 36 36' className='block size-7'>
					<circle cx='18' cy='18' r='12' className='fill-none stroke-foreground/6' strokeWidth={6} />
					<circle
						cx='18'
						cy='18'
						r='12'
						transform='rotate(-90 18 18)'
						strokeDasharray={75.4}
						strokeWidth={6}
						className={cn('fill-none stroke-primary/90', ANIMATED)}
						style={animation('app-preview-pie-fill')}
					/>
				</svg>
				<BlockPencil className='-top-1 left-6' />
			</div>
			<div className={cn('absolute top-[5px] h-6 w-[46px]', isToolPart ? 'left-[72px]' : 'left-[88px]')}>
				<svg viewBox='0 0 46 24' className='block h-6 w-[46px] overflow-visible'>
					<path d='M2 22H44' className='fill-none stroke-foreground/6' strokeWidth={1} />
					<path
						d={SPARKLINE_PATH}
						pathLength={100}
						strokeDasharray={100}
						strokeWidth={1.8}
						strokeLinecap='round'
						strokeLinejoin='round'
						className={cn('fill-none stroke-primary', ANIMATED)}
						style={animation('app-preview-spark-draw')}
					/>
				</svg>
				<BlockPencil className={cn('-top-1.5', isToolPart ? 'left-[38px]' : 'left-[42px]')} />
			</div>
		</StoryBlock>
	);
}

function StoryBlock({
	tab,
	isToolPart,
	className,
	children,
}: {
	tab: number;
	isToolPart: boolean;
	className: string;
	children: ReactNode;
}) {
	return (
		<div
			className={cn('absolute top-7 h-[34px]', isToolPart ? 'left-16' : 'left-[76px]', className, ANIMATED)}
			style={animation(`app-preview-tab-${tab}`)}
		>
			{children}
		</div>
	);
}

function BlockPencil({ className }: { className: string }) {
	return (
		<div
			className={cn(
				'absolute z-10 flex size-2 items-center justify-center rounded-full border bg-card',
				className,
			)}
		>
			<Pencil className='size-[5px] text-primary' strokeWidth={3} />
		</div>
	);
}

function BarTooltip() {
	return (
		<div
			className={cn('absolute top-[17.2px] left-[145.6px] h-[18px] w-[30px]', ANIMATED)}
			style={animation('app-preview-hover')}
		>
			<div className='flex h-3.5 w-[30px] flex-col justify-center gap-0.5 rounded-[4px] border bg-card px-[5px] shadow-[0_4px_10px_-4px_rgba(17,17,40,0.25)]'>
				<div className='h-[3px] w-3.5 rounded-[1px] bg-primary' />
				<div className='h-[1.5px] w-[18px] rounded-[1px] bg-foreground/12' />
			</div>
			<div className='absolute top-[10.5px] left-[12.5px] size-[5px] rotate-45 border-r border-b bg-card' />
		</div>
	);
}

function ClickRipple({ x, y, atSeconds }: { x: number; y: number; atSeconds: number }) {
	return (
		<div
			className={cn('absolute size-[18px] rounded-full border-[1.5px] border-primary/60 opacity-0', ANIMATED)}
			style={{ left: x - 9, top: y - 9, ...animation('app-preview-ripple', atSeconds) }}
		/>
	);
}

function Pointer() {
	return (
		<svg
			viewBox='0 0 24 24'
			className={cn(
				'absolute top-[22.3px] left-[110.4px] z-20 size-[15px] origin-[2.5px_1.9px] fill-card stroke-foreground drop-shadow-[0_1px_1.5px_rgba(0,0,0,0.25)]',
				ANIMATED,
			)}
			strokeWidth={1.6}
			strokeLinejoin='round'
			style={{ ...animation('app-preview-pointer'), animationTimingFunction: 'ease-in-out' }}
		>
			<path d={POINTER_PATH} />
		</svg>
	);
}

function animation(name: string, delaySeconds = 0): CSSProperties {
	return { animationName: name, '--app-preview-delay': `${delaySeconds}s` } as CSSProperties;
}
