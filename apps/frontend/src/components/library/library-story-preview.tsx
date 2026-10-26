import { useRef, useState } from 'react';
import { ArrowDown, ArrowUp, BarChart3, Filter, GripVertical, LineChart, Pencil, Plus, Trash2 } from 'lucide-react';
import {
	Bar,
	BarChart,
	CartesianGrid,
	Line,
	LineChart as RechartsLineChart,
	ResponsiveContainer,
	XAxis,
	YAxis,
} from 'recharts';
import type { ReactNode } from 'react';
import type { LibraryItem, MockStory, MockStoryBlock } from '@/lib/library';
import { Button } from '@/components/ui/button';
import { SimpleTooltip } from '@/components/ui/tooltip';
import { getTimeAgo } from '@/lib/time-ago';
import { cn } from '@/lib/utils';

interface StoryDraft {
	title: string;
	blocks: MockStoryBlock[];
}

/** Story opened from the library, editable in place through controls that appear on hover. */
export function LibraryStoryPreview({ item, story }: { item: LibraryItem; story: MockStory }) {
	const [saved, setSaved] = useState<StoryDraft>({ title: item.name, blocks: story.blocks });
	const [draft, setDraft] = useState<StoryDraft>(saved);
	const [revision, setRevision] = useState(0);
	const isDirty = draft !== saved;

	const updateBlocks = (update: (blocks: MockStoryBlock[]) => MockStoryBlock[]) =>
		setDraft((current) => ({ ...current, blocks: update(current.blocks) }));
	const updateBlock = (blockId: string, update: (block: MockStoryBlock) => MockStoryBlock) =>
		updateBlocks((blocks) => blocks.map((block) => (block.id === blockId ? update(block) : block)));
	const moveBlock = (blockId: string, offset: -1 | 1) => updateBlocks((blocks) => moveItem(blocks, blockId, offset));
	const deleteBlock = (blockId: string) => updateBlocks((blocks) => blocks.filter((block) => block.id !== blockId));
	const discardChanges = () => {
		setDraft(saved);
		setRevision((value) => value + 1);
	};

	return (
		<div className='relative flex h-full min-h-0 flex-col'>
			<div className='min-h-0 flex-1 overflow-y-auto'>
				<article className='mx-auto flex max-w-3xl flex-col gap-2 px-10 pb-24 pt-8'>
					<header className='group/story-header mb-2 flex flex-col gap-1'>
						<EditableText
							key={`title-${revision}`}
							value={draft.title}
							onChange={(title) => setDraft((current) => ({ ...current, title }))}
							className='text-2xl font-semibold tracking-tight'
						/>
						<p className='text-sm text-muted-foreground'>
							{story.subtitle} · updated {getTimeAgo(item.updatedAt).humanReadable}
						</p>
						<div className='mt-1 flex gap-1.5 opacity-0 transition-opacity group-hover/story-header:opacity-100'>
							<HoverAddButton icon={<Filter className='size-3' />} label='Add filter' />
							<HoverAddButton icon={<Plus className='size-3' />} label='Add tab' />
						</div>
					</header>

					{draft.blocks.map((block, index) => (
						<StoryBlockFrame
							key={block.id}
							block={block}
							isFirst={index === 0}
							isLast={index === draft.blocks.length - 1}
							onMove={(offset) => moveBlock(block.id, offset)}
							onDelete={() => deleteBlock(block.id)}
							onToggleChartType={() => updateBlock(block.id, toggleChartType)}
						>
							<StoryBlockContent
								key={`${block.id}-${revision}`}
								block={block}
								onTextChange={(text) => updateBlock(block.id, (current) => ({ ...current, text }))}
							/>
						</StoryBlockFrame>
					))}
				</article>
			</div>
			{isDirty && <UnsavedChangesBar onDiscard={discardChanges} onSave={() => setSaved(draft)} />}
		</div>
	);
}

interface StoryBlockFrameProps {
	block: MockStoryBlock;
	isFirst: boolean;
	isLast: boolean;
	children: ReactNode;
	onMove: (offset: -1 | 1) => void;
	onDelete: () => void;
	onToggleChartType: () => void;
}

function StoryBlockFrame({
	block,
	isFirst,
	isLast,
	children,
	onMove,
	onDelete,
	onToggleChartType,
}: StoryBlockFrameProps) {
	const frameRef = useRef<HTMLDivElement>(null);
	const focusText = () => frameRef.current?.querySelector<HTMLElement>('[contenteditable]')?.focus();

	return (
		<div
			ref={frameRef}
			className='group/block relative -mx-3 rounded-xl px-3 py-2 ring-1 ring-transparent transition-shadow hover:ring-border'
		>
			<span className='absolute -left-5 top-3 flex cursor-grab text-muted-foreground opacity-0 group-hover/block:opacity-100'>
				<GripVertical className='size-4' />
			</span>
			<div className='absolute -top-3.5 right-2 z-10 hidden items-center gap-0.5 rounded-lg border bg-background p-0.5 shadow-sm group-hover/block:flex'>
				{(block.kind === 'text' || block.kind === 'heading') && (
					<BlockAction label='Edit text' onClick={focusText}>
						<Pencil />
					</BlockAction>
				)}
				{block.kind === 'chart' && (
					<BlockAction
						label={block.chartType === 'bar' ? 'Switch to line chart' : 'Switch to bar chart'}
						onClick={onToggleChartType}
					>
						{block.chartType === 'bar' ? <LineChart /> : <BarChart3 />}
					</BlockAction>
				)}
				{block.kind === 'chart' && (
					<BlockAction label='Edit chart' onClick={() => {}}>
						<Pencil />
					</BlockAction>
				)}
				<BlockAction label='Move up' onClick={() => onMove(-1)} disabled={isFirst}>
					<ArrowUp />
				</BlockAction>
				<BlockAction label='Move down' onClick={() => onMove(1)} disabled={isLast}>
					<ArrowDown />
				</BlockAction>
				<BlockAction label='Remove' onClick={onDelete}>
					<Trash2 />
				</BlockAction>
			</div>
			{children}
		</div>
	);
}

function StoryBlockContent({ block, onTextChange }: { block: MockStoryBlock; onTextChange: (text: string) => void }) {
	switch (block.kind) {
		case 'heading':
			return <EditableText value={block.text} onChange={onTextChange} className='text-lg font-semibold' />;
		case 'text':
			return <EditableText value={block.text} onChange={onTextChange} className='text-sm leading-6' />;
		case 'kpis':
			return (
				<div className='grid grid-cols-[repeat(auto-fit,minmax(140px,1fr))] gap-3'>
					{block.kpis.map((kpi) => (
						<div key={kpi.label} className='rounded-xl border bg-background p-3'>
							<div className='text-xs text-muted-foreground'>{kpi.label}</div>
							<div className='mt-1 text-xl font-semibold tabular-nums'>{kpi.value}</div>
							<div
								className={cn(
									'text-xs font-medium',
									kpi.isPositive ? 'text-emerald-600' : 'text-red-500',
								)}
							>
								{kpi.delta}
							</div>
						</div>
					))}
				</div>
			);
		case 'chart':
			return <StoryChart block={block} />;
	}
}

function StoryChart({ block }: { block: Extract<MockStoryBlock, { kind: 'chart' }> }) {
	const axisProps = { tickLine: false, axisLine: false, fontSize: 11, stroke: 'var(--muted-foreground)' };

	return (
		<figure className='rounded-xl border bg-background p-4'>
			<figcaption className='mb-3 text-sm font-medium'>{block.title}</figcaption>
			<div className='h-56'>
				<ResponsiveContainer width='100%' height='100%'>
					{block.chartType === 'bar' ? (
						<BarChart data={block.points}>
							<CartesianGrid vertical={false} stroke='var(--border)' />
							<XAxis dataKey='label' {...axisProps} />
							<YAxis width={40} {...axisProps} />
							<Bar dataKey='value' fill='var(--violet)' radius={[6, 6, 0, 0]} />
						</BarChart>
					) : (
						<RechartsLineChart data={block.points}>
							<CartesianGrid vertical={false} stroke='var(--border)' />
							<XAxis dataKey='label' {...axisProps} />
							<YAxis width={40} {...axisProps} />
							<Line dataKey='value' stroke='var(--violet)' strokeWidth={2} dot={false} type='monotone' />
						</RechartsLineChart>
					)}
				</ResponsiveContainer>
			</div>
		</figure>
	);
}

function EditableText({
	value,
	onChange,
	className,
}: {
	value: string;
	onChange: (value: string) => void;
	className?: string;
}) {
	return (
		<div
			contentEditable
			suppressContentEditableWarning
			spellCheck={false}
			onBlur={(event) => {
				const text = event.currentTarget.textContent ?? '';
				if (text !== value) {
					onChange(text);
				}
			}}
			className={cn('cursor-text rounded-md outline-none focus:bg-accent/40', className)}
		>
			{value}
		</div>
	);
}

function BlockAction({
	label,
	onClick,
	disabled,
	children,
}: {
	label: string;
	onClick: () => void;
	disabled?: boolean;
	children: ReactNode;
}) {
	return (
		<SimpleTooltip content={label}>
			<button
				type='button'
				onClick={onClick}
				disabled={disabled}
				aria-label={label}
				className='flex size-6 cursor-pointer items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground disabled:cursor-default disabled:opacity-40 [&_svg]:size-3.5'
			>
				{children}
			</button>
		</SimpleTooltip>
	);
}

function HoverAddButton({ icon, label }: { icon: ReactNode; label: string }) {
	return (
		<button
			type='button'
			className='flex cursor-pointer items-center gap-1 rounded-full border border-dashed px-2.5 py-0.5 text-xs text-muted-foreground hover:border-foreground/40 hover:text-foreground'
		>
			{icon}
			{label}
		</button>
	);
}

function UnsavedChangesBar({ onDiscard, onSave }: { onDiscard: () => void; onSave: () => void }) {
	return (
		<div className='absolute inset-x-0 bottom-4 flex justify-center px-4'>
			<div className='flex items-center gap-3 rounded-full border bg-background py-1.5 pl-4 pr-1.5 shadow-lg animate-fade-in'>
				<span className='text-sm text-muted-foreground'>Unsaved changes</span>
				<Button variant='ghost' size='sm' className='rounded-full' onClick={onDiscard}>
					Discard
				</Button>
				<Button size='sm' className='rounded-full' onClick={onSave}>
					Save
				</Button>
			</div>
		</div>
	);
}

function toggleChartType(block: MockStoryBlock): MockStoryBlock {
	return block.kind === 'chart' ? { ...block, chartType: block.chartType === 'bar' ? 'line' : 'bar' } : block;
}

function moveItem<T extends { id: string }>(items: T[], id: string, offset: -1 | 1): T[] {
	const index = items.findIndex((item) => item.id === id);
	const target = index + offset;
	if (index < 0 || target < 0 || target >= items.length) {
		return items;
	}
	const next = [...items];
	[next[index], next[target]] = [next[target], next[index]];
	return next;
}
