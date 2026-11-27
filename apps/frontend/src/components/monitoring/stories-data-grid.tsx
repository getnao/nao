import {
	flexRender,
	getCoreRowModel,
	getExpandedRowModel,
	getFilteredRowModel,
	getGroupedRowModel,
	getPaginationRowModel,
	getSortedRowModel,
	useReactTable,
} from '@tanstack/react-table';
import { ArrowDown, ArrowUp, ChevronDown, ChevronRight, Columns3, Group, Search } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import type {
	Column,
	ColumnDef,
	ColumnFiltersState,
	ExpandedState,
	GroupingState,
	Row,
	SortingState,
} from '@tanstack/react-table';

import type { GridStory, GridStoryStatus } from '@/lib/story-monitoring-mock';
import type { StorySummary } from '@nao/shared/types';
import type { QueryDataMap } from '@/components/story-embeds';
import { CustomStoryThumbnail } from '@/components/custom-story-thumbnail';
import { Bars } from '@/components/story-monitoring-kpis';
import { StoryThumbnail } from '@/components/story-thumbnail';
import {
	DropdownMenu,
	DropdownMenuCheckboxItem,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { TablePagination } from '@/components/ui/table-pagination';
import { formatInteger, formatPercent } from '@/lib/monitoring-format';
import { buildGridStories, formatUsd } from '@/lib/story-monitoring-mock';
import { cn } from '@/lib/utils';
import { trpc } from '@/main';

export type QuickFilter = 'over_limit' | 'unread' | 'failing';
type GroupableColumn = 'owner' | 'status' | 'schedule';

const STORIES = buildGridStories();
const MOCK_PARAMS = new URLSearchParams(window.location.search);

const STATUS_LABELS: Record<GridStoryStatus, string> = { live: 'Live', not_live: 'Not live', archived: 'Archived' };

const QUICK_FILTERS: { id: QuickFilter; label: string; match: (story: GridStory) => boolean }[] = [
	{ id: 'over_limit', label: 'Over limit', match: (story) => story.costPerDay > story.limit },
	{ id: 'unread', label: 'Live, no reader', match: (story) => story.status === 'live' && story.views === 0 },
	{ id: 'failing', label: 'Failing', match: (story) => story.failureRate >= 0.05 },
];

const GROUP_OPTIONS: { value: GroupableColumn | 'none'; label: string }[] = [
	{ value: 'none', label: 'No grouping' },
	{ value: 'owner', label: 'Owner' },
	{ value: 'status', label: 'Status' },
	{ value: 'schedule', label: 'Refresh schedule' },
];

/** Spreadsheet-like list of every story: sort and filter any column, group by owner to get a leaderboard. */
export function StoriesDataGrid({
	quickFilters,
	onQuickFiltersChange: setQuickFilters,
	onOpenStory,
}: {
	quickFilters: QuickFilter[];
	onQuickFiltersChange: (filters: QuickFilter[]) => void;
	onOpenStory: (story: GridStory) => void;
}) {
	const [search, setSearch] = useState('');
	const [sorting, setSorting] = useState<SortingState>([{ id: 'costPerDay', desc: true }]);
	const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>(
		MOCK_PARAMS.get('status') ? [{ id: 'status', value: [MOCK_PARAMS.get('status')] }] : [],
	);
	const [grouping, setGrouping] = useState<GroupingState>(
		MOCK_PARAMS.get('group') ? [MOCK_PARAMS.get('group')!] : [],
	);
	const [expanded, setExpanded] = useState<ExpandedState>(
		MOCK_PARAMS.get('group') ? { 'owner:Lucas Moreau': true } : {},
	);
	const thumbnails = useRealThumbnails();
	const columns = useMemo(() => buildColumns(thumbnails), [thumbnails]);

	const data = useMemo(() => {
		const query = search.trim().toLowerCase();
		return STORIES.filter(
			(story) =>
				(!query || story.title.toLowerCase().includes(query) || story.owner.toLowerCase().includes(query)) &&
				quickFilters.every((id) => QUICK_FILTERS.find((filter) => filter.id === id)!.match(story)),
		);
	}, [search, quickFilters]);

	const table = useReactTable({
		data,
		columns,
		state: { sorting, columnFilters, grouping, expanded },
		onSortingChange: setSorting,
		onColumnFiltersChange: setColumnFilters,
		onGroupingChange: setGrouping,
		onExpandedChange: setExpanded,
		getCoreRowModel: getCoreRowModel(),
		getFilteredRowModel: getFilteredRowModel(),
		getSortedRowModel: getSortedRowModel(),
		getGroupedRowModel: getGroupedRowModel(),
		getExpandedRowModel: getExpandedRowModel(),
		getPaginationRowModel: getPaginationRowModel(),
		paginateExpandedRows: false,
		autoResetExpanded: false,
		initialState: { pagination: { pageSize: 15 } },
	});

	const groupValue = (grouping[0] as GroupableColumn | undefined) ?? 'none';
	const filteredCount = table.getFilteredRowModel().rows.length;

	return (
		<div className='flex min-w-0 flex-col gap-3'>
			<div className='flex flex-wrap items-center gap-2'>
				<label className='flex h-8 w-56 items-center gap-2 rounded-md border px-2.5 text-sm'>
					<Search className='size-3.5 text-muted-foreground' />
					<input
						value={search}
						onChange={(event) => setSearch(event.target.value)}
						placeholder='Search stories or owners…'
						className='min-w-0 flex-1 bg-transparent outline-none placeholder:text-muted-foreground'
					/>
				</label>
				{QUICK_FILTERS.map((filter) => {
					const isOn = quickFilters.includes(filter.id);
					return (
						<button
							key={filter.id}
							type='button'
							onClick={() =>
								setQuickFilters(
									isOn ? quickFilters.filter((id) => id !== filter.id) : [...quickFilters, filter.id],
								)
							}
							className={cn(
								'h-8 rounded-full border px-3 text-xs',
								isOn
									? 'bg-accent font-medium text-foreground'
									: 'text-muted-foreground hover:text-foreground',
							)}
						>
							{filter.label}
							<span className='ml-1.5 text-muted-foreground'>{STORIES.filter(filter.match).length}</span>
						</button>
					);
				})}
				<div className='ml-auto flex items-center gap-2'>
					<span className='text-xs text-muted-foreground'>
						{formatInteger(filteredCount)} of {formatInteger(STORIES.length)} stories
					</span>
					<Select
						value={groupValue}
						onValueChange={(value) => {
							setGrouping(value === 'none' ? [] : [value]);
							setExpanded({});
						}}
					>
						<SelectTrigger className='h-8 w-auto gap-1.5 text-xs'>
							<Group className='size-3.5' />
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							{GROUP_OPTIONS.map((option) => (
								<SelectItem key={option.value} value={option.value}>
									{option.value === 'none' ? option.label : `Group by ${option.label.toLowerCase()}`}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
					<button
						type='button'
						className='flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-xs text-muted-foreground'
					>
						<Columns3 className='size-3.5' />
						Columns
					</button>
				</div>
			</div>

			{columnFilters.length > 0 && (
				<div className='flex flex-wrap items-center gap-1.5 text-xs'>
					{columnFilters.map((filter) => (
						<span key={filter.id} className='flex items-center gap-1 rounded-full bg-muted px-2.5 py-1'>
							<span className='text-muted-foreground'>{COLUMN_LABELS[filter.id]}:</span>
							{(filter.value as string[])
								.map((value) =>
									filter.id === 'status' ? STATUS_LABELS[value as GridStoryStatus] : value,
								)
								.join(', ')}
							<button
								type='button'
								className='ml-1 text-muted-foreground hover:text-foreground'
								onClick={() => table.getColumn(filter.id)?.setFilterValue(undefined)}
							>
								×
							</button>
						</span>
					))}
				</div>
			)}

			<div className='overflow-x-auto rounded-lg border'>
				<table className='w-full min-w-[900px] text-sm'>
					<TableHeader className='bg-muted/40'>
						{table.getHeaderGroups().map((headerGroup) => (
							<TableRow key={headerGroup.id} className='hover:bg-transparent'>
								{headerGroup.headers.map((header) => (
									<TableHead
										key={header.id}
										className={cn(
											'h-9 px-3',
											header.column.columnDef.meta?.align === 'right' && 'text-right',
										)}
									>
										<ColumnMenu
											column={header.column}
											isOpen={MOCK_PARAMS.get('menu') === header.column.id}
										/>
									</TableHead>
								))}
							</TableRow>
						))}
					</TableHeader>
					<TableBody>
						{table.getRowModel().rows.map((row) => (
							<GridRow key={row.id} row={row} onOpenStory={onOpenStory} />
						))}
					</TableBody>
				</table>
			</div>
			<TablePagination
				totalRows={table.getPrePaginationRowModel().rows.length}
				pageIndex={table.getState().pagination.pageIndex}
				pageSize={table.getState().pagination.pageSize}
				pageCount={table.getPageCount()}
				pageSizeOptions={[15, 50, 100]}
				onPageChange={(page) => table.setPageIndex(page)}
				onPageSizeChange={(size) => table.setPageSize(size)}
			/>
		</div>
	);
}

function GridRow({ row, onOpenStory }: { row: Row<GridStory>; onOpenStory: (story: GridStory) => void }) {
	const isGroup = row.getIsGrouped();
	return (
		<TableRow
			onClick={isGroup ? row.getToggleExpandedHandler() : () => onOpenStory(row.original)}
			className={cn('cursor-pointer', isGroup && 'bg-muted/25 font-medium', row.depth > 0 && 'text-[13px]')}
		>
			{row.getVisibleCells().map((cell) => (
				<TableCell
					key={cell.id}
					className={cn(
						'px-3 py-2',
						cell.column.columnDef.meta?.align === 'right' && 'text-right tabular-nums',
					)}
				>
					{cell.getIsGrouped() ? (
						<span className='flex items-center gap-1.5'>
							{row.getIsExpanded() ? (
								<ChevronDown className='size-3.5' />
							) : (
								<ChevronRight className='size-3.5' />
							)}
							{cell.column.id === 'status'
								? STATUS_LABELS[cell.getValue() as GridStoryStatus]
								: String(cell.getValue())}
						</span>
					) : cell.getIsAggregated() ? (
						flexRender(
							cell.column.columnDef.aggregatedCell ?? cell.column.columnDef.cell,
							cell.getContext(),
						)
					) : cell.getIsPlaceholder() ? null : (
						flexRender(cell.column.columnDef.cell, cell.getContext())
					)}
				</TableCell>
			))}
		</TableRow>
	);
}

/** Header as a menu, like a spreadsheet: sort, filter on the column's values, group by it. */
function ColumnMenu({ column, isOpen }: { column: Column<GridStory>; isOpen: boolean }) {
	const sorted = column.getIsSorted();
	const filterValues = (column.getFilterValue() as string[] | undefined) ?? [];
	const canFilter = column.getCanFilter() && column.columnDef.meta?.filterable;
	const facets = canFilter ? countValues(column.id as keyof GridStory) : [];
	const label = COLUMN_LABELS[column.id];

	return (
		<DropdownMenu defaultOpen={isOpen}>
			<DropdownMenuTrigger
				className={cn(
					'inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground',
					(sorted || filterValues.length > 0) && 'text-foreground',
				)}
			>
				{label}
				{sorted === 'asc' && <ArrowUp className='size-3' />}
				{sorted === 'desc' && <ArrowDown className='size-3' />}
				{filterValues.length > 0 && <span className='size-1.5 rounded-full bg-primary' />}
				<ChevronDown className='size-3 opacity-50' />
			</DropdownMenuTrigger>
			<DropdownMenuContent align='start' className='w-56'>
				<DropdownMenuItem onSelect={() => column.toggleSorting(false)}>
					<ArrowUp /> Sort ascending
				</DropdownMenuItem>
				<DropdownMenuItem onSelect={() => column.toggleSorting(true)}>
					<ArrowDown /> Sort descending
				</DropdownMenuItem>
				{column.getCanGroup() && (
					<DropdownMenuItem onSelect={() => column.toggleGrouping()}>
						<Group /> {column.getIsGrouped() ? 'Ungroup' : `Group by ${label.toLowerCase()}`}
					</DropdownMenuItem>
				)}
				{canFilter && (
					<>
						<DropdownMenuSeparator />
						<DropdownMenuLabel className='text-xs text-muted-foreground'>Show only</DropdownMenuLabel>
						{facets.map(([value, count]) => (
							<DropdownMenuCheckboxItem
								key={value}
								checked={filterValues.includes(value)}
								onSelect={(event) => event.preventDefault()}
								onCheckedChange={(checked) => {
									const next = checked
										? [...filterValues, value]
										: filterValues.filter((item) => item !== value);
									column.setFilterValue(next.length ? next : undefined);
								}}
							>
								<span className='flex-1 truncate'>
									{column.id === 'status' ? STATUS_LABELS[value as GridStoryStatus] : value}
								</span>
								<span className='text-xs text-muted-foreground tabular-nums'>{count}</span>
							</DropdownMenuCheckboxItem>
						))}
					</>
				)}
			</DropdownMenuContent>
		</DropdownMenu>
	);
}

function countValues(key: keyof GridStory): [string, number][] {
	const counts = new Map<string, number>();
	for (const story of STORIES) {
		const value = String(story[key]);
		counts.set(value, (counts.get(value) ?? 0) + 1);
	}
	return [...counts.entries()].sort((left, right) => right[1] - left[1]);
}

const COLUMN_LABELS: Record<string, string> = {
	title: 'Story',
	owner: 'Owner',
	status: 'Status',
	schedule: 'Refresh',
	views: 'Views',
	lastReadDays: 'Last read',
	failureRate: 'Failures',
	costPerDay: 'Cost per day',
};

const valuesIn = (row: Row<GridStory>, id: string, filterValue: string[]) =>
	filterValue.includes(String(row.getValue(id)));

function buildColumns(thumbnails: ThumbnailSource[]): ColumnDef<GridStory>[] {
	return [
		{
			accessorKey: 'title',
			enableGrouping: false,
			cell: ({ row }) => (
				<span className='flex items-center gap-2.5'>
					<GridThumbnail source={pickThumbnail(thumbnails, row.original.id)} />
					<span className='block max-w-44 truncate font-medium'>{row.original.title}</span>
				</span>
			),
			aggregationFn: (_columnId, leafRows) => leafRows.length,
			aggregatedCell: ({ row }) => {
				const leaves = row.getLeafRows();
				const live = leaves.filter((leaf) => leaf.original.status === 'live').length;
				return (
					<span className='font-normal text-muted-foreground'>
						{leaves.length} stories · {live} live
					</span>
				);
			},
		},
		{
			accessorKey: 'owner',
			filterFn: valuesIn,
			meta: { filterable: true },
			cell: ({ row }) => (
				<span className='flex items-center gap-2 whitespace-nowrap'>
					<span className='flex size-5 items-center justify-center rounded-full bg-muted text-[10px] font-medium'>
						{row.original.owner
							.split(' ')
							.map((part) => part[0])
							.join('')}
					</span>
					{row.original.owner}
				</span>
			),
		},
		{
			accessorKey: 'status',
			filterFn: valuesIn,
			meta: { filterable: true },
			cell: ({ row }) => <StatusPill status={row.original.status} />,
		},
		{
			accessorKey: 'schedule',
			filterFn: valuesIn,
			meta: { filterable: true },
			cell: ({ row }) => <span className='whitespace-nowrap text-muted-foreground'>{row.original.schedule}</span>,
		},
		{
			accessorKey: 'views',
			aggregationFn: 'sum',
			meta: { align: 'right' },
			cell: ({ row }) => <ViewsCell views={row.original.views} readers={row.original.readers} />,
			aggregatedCell: ({ row, getValue }) => (
				<ViewsCell
					views={getValue<number>()}
					readers={row.getLeafRows().reduce((sum, leaf) => sum + (leaf.original?.readers ?? 0), 0)}
				/>
			),
		},
		{
			accessorKey: 'lastReadDays',
			aggregationFn: 'min',
			sortUndefined: 'last',
			cell: ({ row, getValue }) => (
				<LastRead days={getValue<number | null>()} isLive={row.original?.status === 'live'} />
			),
			aggregatedCell: ({ getValue }) => <LastRead days={getValue<number | null>()} isLive={false} />,
		},
		{
			accessorKey: 'failureRate',
			aggregationFn: 'mean',
			meta: { align: 'right' },
			cell: ({ getValue }) => <FailureRate rate={getValue<number>()} />,
			aggregatedCell: ({ getValue }) => <FailureRate rate={getValue<number>()} />,
		},
		{
			accessorKey: 'costPerDay',
			aggregationFn: 'sum',
			meta: { align: 'right' },
			cell: ({ row }) => <CostCell story={row.original} />,
			aggregatedCell: ({ getValue, row }) => (
				<span className='inline-flex items-center justify-end gap-2 whitespace-nowrap'>
					<span className='h-1.5 w-16 shrink-0 overflow-hidden rounded-full bg-muted'>
						<span
							className='block h-full rounded-full bg-chart-1'
							style={{ width: `${Math.min(100, (getValue<number>() / 12) * 100)}%` }}
						/>
					</span>
					<span
						className={cn(
							'min-w-11 text-right',
							row.getLeafRows().some((leaf) => leaf.original.costPerDay > leaf.original.limit) &&
								'text-destructive',
						)}
					>
						{formatUsd(getValue<number>())}
					</span>
				</span>
			),
		},
	];
}

interface ThumbnailSource {
	storyId: string;
	version?: number;
	format: string;
	summary: StorySummary;
	kpiPreviewData: QueryDataMap | null;
}

/** Mock only: the grid's fake rows borrow the thumbnails of the project's real stories. */
function useRealThumbnails(): ThumbnailSource[] {
	const project = useQuery(trpc.project.getCurrent.queryOptions());
	const stories = useQuery({
		...trpc.story.listAll.queryOptions({ projectId: project.data?.id }),
		enabled: !!project.data?.id,
	});
	return useMemo(
		() =>
			(stories.data ?? [])
				.filter((story) => story.summary.segments.length > 0)
				.map((story) => ({
					storyId: story.id,
					version: story.version,
					format: story.format,
					summary: story.summary,
					kpiPreviewData: story.kpiPreviewData as QueryDataMap | null,
				})),
		[stories.data],
	);
}

function pickThumbnail(thumbnails: ThumbnailSource[], rowId: string): ThumbnailSource | undefined {
	return thumbnails.length ? thumbnails[Number(rowId.slice(1)) % thumbnails.length] : undefined;
}

function GridThumbnail({ source }: { source?: ThumbnailSource }) {
	return (
		<span className='relative h-9 w-14 shrink-0 overflow-hidden rounded-md bg-muted/50'>
			{source &&
				(source.format === 'custom' ? (
					<CustomStoryThumbnail
						storyId={source.storyId}
						version={source.version}
						summary={source.summary}
						queryData={source.kpiPreviewData}
						isToolPart
					/>
				) : (
					<StoryThumbnail
						summary={source.summary}
						queryData={source.kpiPreviewData}
						isToolPart
						className='overflow-visible'
					/>
				))}
		</span>
	);
}

function ViewsCell({ views, readers }: { views: number; readers: number }) {
	return (
		<span className='flex flex-col items-end leading-tight'>
			<span>{formatInteger(views)}</span>
			<span className='text-xs text-muted-foreground'>{formatInteger(readers)} readers</span>
		</span>
	);
}

function StatusPill({ status }: { status: GridStoryStatus }) {
	return (
		<span
			className={cn(
				'inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs',
				status === 'live'
					? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400'
					: 'bg-muted text-muted-foreground',
			)}
		>
			{status === 'live' && <span className='size-1.5 rounded-full bg-emerald-500' />}
			{STATUS_LABELS[status]}
		</span>
	);
}

function LastRead({ days, isLive }: { days: number | null; isLive: boolean }) {
	if (days === null) {
		return <span className='text-muted-foreground'>never</span>;
	}
	const label = days === 0 ? 'today' : days === 1 ? 'yesterday' : `${days} days ago`;
	return (
		<span
			className={cn(
				'whitespace-nowrap',
				isLive && days > 14 ? 'text-amber-600 dark:text-amber-500' : 'text-muted-foreground',
			)}
		>
			{label}
		</span>
	);
}

function FailureRate({ rate }: { rate: number }) {
	return <span className={cn(rate >= 0.05 && 'text-destructive')}>{rate > 0 ? formatPercent(rate) : '—'}</span>;
}

function CostCell({ story }: { story: GridStory }) {
	if (story.status !== 'live') {
		return <span className='text-muted-foreground'>—</span>;
	}
	const isOver = story.costPerDay > story.limit;
	return (
		<span className='inline-flex items-center justify-end gap-2 whitespace-nowrap'>
			<span className='h-5 w-16 shrink-0'>
				<Bars values={story.dailyCost} threshold={story.limit} />
			</span>
			<span className={cn('min-w-11 text-right', isOver && 'font-medium text-destructive')}>
				{formatUsd(story.costPerDay)}
			</span>
		</span>
	);
}

declare module '@tanstack/react-table' {
	// eslint-disable-next-line @typescript-eslint/no-unused-vars -- the augmentation must repeat the library's type parameters
	interface ColumnMeta<TData, TValue> {
		align?: 'right';
		filterable?: boolean;
	}
}
