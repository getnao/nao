import { CalendarDays, CaseSensitive, Hash, PanelLeftClose, PanelLeftOpen, Search, ToggleLeft } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { LucideIcon } from 'lucide-react';

import type { ChartSelectionSummary, ColumnProfile, ColumnValueKind } from '@/lib/chart-selection-summary';
import { Button } from '@/components/ui/button';
import { DatabaseIcon } from '@/components/ui/database-icon';
import { Input } from '@/components/ui/input';
import { startColumnDrag } from '@/hooks/use-column-drag';
import { profileColumn } from '@/lib/chart-selection-summary';
import { cn } from '@/lib/utils';

const X_AXIS_USAGE_COLOR = 'var(--muted-foreground)';

const KIND_ICONS: Record<ColumnValueKind, LucideIcon> = {
	number: Hash,
	date: CalendarDays,
	boolean: ToggleLeft,
	text: CaseSensitive,
	mixed: CaseSensitive,
	empty: CaseSensitive,
};

interface ChartEditorDataPanelProps {
	columns: string[];
	data: Record<string, unknown>[];
	summary: ChartSelectionSummary;
	onCollapse: () => void;
	onEditQuery?: () => void;
	isEditingQuery?: boolean;
	dialect?: string;
	className?: string;
}

/** Left pane of the chart editor: the query result columns and the entry point to edit the SQL. */
export function ChartEditorDataPanel({
	columns,
	data,
	summary,
	onCollapse,
	onEditQuery,
	isEditingQuery = false,
	dialect,
	className,
}: ChartEditorDataPanelProps) {
	const [search, setSearch] = useState('');
	const profiles = useMemo(() => columns.map((column) => profileColumn(data, column)), [columns, data]);
	const usageByColumn = useMemo(() => buildColumnUsage(summary), [summary]);
	const visibleProfiles = filterProfiles(profiles, search);

	return (
		<aside className={cn('min-h-0 flex-col select-none', className)}>
			{onEditQuery && (
				<div className='flex h-12 shrink-0 items-center border-b px-3'>
					<Button
						type='button'
						variant='outline'
						size='sm'
						className='w-full rounded-full text-xs'
						onClick={onEditQuery}
						disabled={isEditingQuery}
					>
						<DatabaseIcon dialect={dialect} className='size-3.5' />
						{isEditingQuery ? 'Editing SQL' : 'Edit SQL'}
					</Button>
				</div>
			)}
			<div className='flex shrink-0 flex-col gap-2 px-4 pt-4 pb-2'>
				<div className='flex items-center gap-2'>
					<h3 className='text-sm font-semibold text-foreground'>Data</h3>
					<span className='ml-auto text-xs text-muted-foreground'>{formatCount(data.length, 'row')}</span>
					<Button
						type='button'
						variant='ghost-muted'
						size='icon-xs'
						className='-mr-1.5'
						onClick={onCollapse}
						aria-label='Collapse data panel'
						title='Collapse data panel'
					>
						<PanelLeftClose className='size-3.5' />
					</Button>
				</div>
				<div className='relative'>
					<Search className='pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground' />
					<Input
						value={search}
						onChange={(event) => setSearch(event.target.value)}
						placeholder='Search columns'
						aria-label='Search columns'
						className='h-8 bg-panel pl-8 text-sm'
					/>
				</div>
			</div>
			<ul className='min-h-0 flex-1 overflow-y-auto px-2 pb-2'>
				{visibleProfiles.map((profile) => (
					<ColumnRow
						key={profile.column}
						profile={profile}
						usageColors={usageByColumn.get(profile.column.toLowerCase())}
					/>
				))}
				{visibleProfiles.length === 0 && (
					<li className='px-2 py-1.5 text-xs text-muted-foreground'>No matching columns.</li>
				)}
			</ul>
		</aside>
	);
}

interface ChartEditorDataRailProps {
	onExpand: () => void;
	onEditQuery?: () => void;
	isEditingQuery?: boolean;
	dialect?: string;
}

/** The data pane once collapsed: a thin rail to reopen it or jump to the SQL editor. */
export function ChartEditorDataRail({
	onExpand,
	onEditQuery,
	isEditingQuery = false,
	dialect,
}: ChartEditorDataRailProps) {
	return (
		<div className='flex h-full flex-col items-center gap-1 py-3'>
			<Button
				type='button'
				variant='ghost-muted'
				size='icon-sm'
				onClick={onExpand}
				aria-label='Expand data panel'
				title='Expand data panel'
			>
				<PanelLeftOpen className='size-4' />
			</Button>
			{onEditQuery && (
				<Button
					type='button'
					variant='ghost-muted'
					size='icon-sm'
					onClick={onEditQuery}
					disabled={isEditingQuery}
					aria-label='Edit SQL'
					title='Edit SQL'
				>
					<DatabaseIcon dialect={dialect} className='size-4' />
				</Button>
			)}
		</div>
	);
}

function ColumnRow({ profile, usageColors }: { profile: ColumnProfile; usageColors?: string[] }) {
	const Icon = KIND_ICONS[profile.kind];
	return (
		<li
			draggable
			onDragStart={(event) => startColumnDrag(event, profile.column, profile.kind)}
			className='flex h-7 cursor-grab items-center gap-2 rounded-md px-2 text-xs text-foreground hover:bg-accent/60 active:cursor-grabbing'
			title={`${profile.column} · ${profile.kind} · drag onto a chart field`}
		>
			<Icon className='size-3.5 shrink-0 text-muted-foreground' />
			<span className='min-w-0 flex-1 truncate font-mono'>{profile.column}</span>
			{usageColors?.map((color, index) => (
				<span
					key={`${color}-${index}`}
					className='size-2 shrink-0 rounded-full'
					style={{ backgroundColor: color }}
					aria-hidden
				/>
			))}
		</li>
	);
}

function buildColumnUsage(summary: ChartSelectionSummary): Map<string, string[]> {
	const usage = new Map<string, string[]>();
	const addUsage = (column: string, color: string) => {
		const key = column.toLowerCase();
		usage.set(key, [...(usage.get(key) ?? []), color]);
	};
	if (summary.xAxis?.exists) {
		addUsage(summary.xAxis.column, X_AXIS_USAGE_COLOR);
	}
	for (const series of summary.series) {
		if (series.profile.exists) {
			addUsage(series.profile.column, series.color);
		}
	}
	return usage;
}

function filterProfiles(profiles: ColumnProfile[], search: string): ColumnProfile[] {
	const needle = search.trim().toLowerCase();
	if (!needle) {
		return profiles;
	}
	return profiles.filter((profile) => profile.column.toLowerCase().includes(needle));
}

function formatCount(count: number, noun: string): string {
	return `${count} ${noun}${count === 1 ? '' : 's'}`;
}
