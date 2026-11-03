import { flexRender, getCoreRowModel, getSortedRowModel, useReactTable } from '@tanstack/react-table';
import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { ColumnDef, Header, Row, SortingState } from '@tanstack/react-table';

import type { TestDataDiff, TestDataDiffRow } from '@/components/settings/test-run-types';
import { cn } from '@/lib/utils';

type Cell = NonNullable<TestDataDiffRow['expected']>[number];
type CellStatus = NonNullable<TestDataDiffRow['statuses']>[number];
type RowKind = 'match' | 'differ' | 'missing' | 'extra';

/** The names of the two sides of the diff: removed rows only exist on the first, added ones on the second. */
export interface DiffSides {
	removed: string;
	added: string;
}

interface GridRow {
	kind: RowKind;
	row: TestDataDiffRow;
}

const ROW_MARKERS: Record<RowKind, string> = { match: '', differ: '±', missing: '−', extra: '+' };
const GUTTER_COLUMN_WIDTH = 28;
const DATA_COLUMN_WIDTH = 150;
const DATA_COLUMN_MIN_WIDTH = 60;

/**
 * The rows of two sides cell by cell in a spreadsheet that fills its pane, whose columns sort and resize, colored like
 * a git diff: red rows only exist on the first side, green ones on the second.
 */
export function TestDataDiffView({ diff, sides }: { diff: TestDataDiff; sides: DiffSides }) {
	const rows = useMemo(() => diff.rows.map((row) => ({ kind: rowKind(row), row })), [diff.rows]);
	const notes = listDiffNotes(diff, sides);

	return (
		<div className='flex min-h-0 min-w-0 flex-1 flex-col text-xs'>
			<DiffGrid diff={diff} rows={rows} sides={sides} />
			{notes.length > 0 && (
				<div className='flex shrink-0 flex-wrap gap-x-3 border-t bg-muted/40 px-2 py-0.5 text-[11px] text-muted-foreground'>
					{notes.map((note) => (
						<span key={note}>{note}</span>
					))}
				</div>
			)}
		</div>
	);
}

function DiffGrid({ diff, rows, sides }: { diff: TestDataDiff; rows: GridRow[]; sides: DiffSides }) {
	const [sorting, setSorting] = useState<SortingState>([]);
	const { removed, added } = sides;
	const columns = useMemo(() => buildColumns(diff, { removed, added }), [diff, removed, added]);
	const table = useReactTable({
		data: rows,
		columns,
		state: { sorting },
		onSortingChange: setSorting,
		getCoreRowModel: getCoreRowModel(),
		getSortedRowModel: getSortedRowModel(),
		columnResizeMode: 'onChange',
		sortDescFirst: false,
		defaultColumn: { size: DATA_COLUMN_WIDTH, minSize: DATA_COLUMN_MIN_WIDTH },
	});

	return (
		<div className='min-h-0 flex-1 overflow-auto bg-background'>
			<table
				className='table-fixed border-collapse font-mono text-[11px]'
				style={{ width: table.getTotalSize(), minWidth: '100%' }}
			>
				<thead className='sticky top-0 z-10 bg-muted'>
					{table.getHeaderGroups().map((headerGroup) => (
						<tr key={headerGroup.id}>
							{headerGroup.headers.map((header) => (
								<DiffGridHeader
									key={header.id}
									header={header}
									isMissing={diff.missingColumns.includes(header.column.id)}
								/>
							))}
							<th aria-hidden className='border-b' />
						</tr>
					))}
				</thead>
				<tbody>
					{table.getRowModel().rows.map((row) => (
						<DiffGridRow key={row.id} row={row} />
					))}
					{rows.length === 0 && (
						<tr>
							<td
								colSpan={columns.length + 1}
								className='px-2 py-3 text-center font-sans text-muted-foreground'
							>
								No rows on either side.
							</td>
						</tr>
					)}
				</tbody>
			</table>
		</div>
	);
}

/** A column header like a spreadsheet's: its name, a sort arrow once sorted or hovered, and a border to drag. */
function DiffGridHeader({ header, isMissing }: { header: Header<GridRow, unknown>; isMissing: boolean }) {
	const { column } = header;
	const sorted = column.getIsSorted();
	const SortIcon = sorted === 'asc' ? ArrowUp : sorted === 'desc' ? ArrowDown : ArrowUpDown;
	return (
		<th
			style={{ width: header.getSize() }}
			className={cn(
				'group relative h-6 border-r border-b p-0 text-left font-normal whitespace-nowrap',
				isMissing ? 'bg-red-500/15 text-red-700 dark:text-red-400' : 'text-muted-foreground',
			)}
		>
			{column.getCanSort() && (
				<button
					type='button'
					onClick={column.getToggleSortingHandler()}
					className='flex h-6 w-full cursor-pointer items-center gap-1 px-1.5 text-left hover:text-foreground'
					title={isMissing ? `The answer has no ${column.id} column` : `Sort by ${column.id}`}
				>
					<span className='min-w-0 flex-1 truncate'>
						{isMissing && '− '}
						{column.id}
					</span>
					<SortIcon
						className={cn(
							'size-3 shrink-0',
							sorted ? 'text-foreground' : 'opacity-0 transition-opacity group-hover:opacity-60',
						)}
					/>
				</button>
			)}
			{column.getCanResize() && (
				<div
					role='separator'
					aria-label={`Resize ${column.id}`}
					onMouseDown={header.getResizeHandler()}
					onTouchStart={header.getResizeHandler()}
					onDoubleClick={() => column.resetSize()}
					className={cn(
						'absolute top-0 -right-0.5 z-10 h-full w-1 cursor-col-resize touch-none select-none hover:bg-primary/60',
						column.getIsResizing() && 'bg-primary',
					)}
				/>
			)}
		</th>
	);
}

function DiffGridRow({ row }: { row: Row<GridRow> }) {
	const { kind } = row.original;
	return (
		<tr
			className={cn(
				'[&>td]:border-b [&>td]:border-border/70',
				kind === 'missing' && 'bg-red-500/10 text-red-700 dark:text-red-400',
				kind === 'extra' && 'bg-green-500/10 text-green-700 dark:text-green-400',
			)}
		>
			{row.getVisibleCells().map((cell) => (
				<td
					key={cell.id}
					className={cn(
						'h-[22px] overflow-hidden border-r text-ellipsis whitespace-nowrap',
						cell.column.id === 'gutter' ? 'bg-muted/60 px-1' : 'px-1.5',
					)}
				>
					{flexRender(cell.column.columnDef.cell, cell.getContext())}
				</td>
			))}
			<td aria-hidden />
		</tr>
	);
}

function buildColumns(diff: TestDataDiff, sides: DiffSides): ColumnDef<GridRow>[] {
	const gutterColumn: ColumnDef<GridRow> = {
		id: 'gutter',
		size: GUTTER_COLUMN_WIDTH,
		minSize: GUTTER_COLUMN_WIDTH,
		enableSorting: false,
		enableResizing: false,
		header: '',
		cell: ({ row, table }) => (
			<RowGutter kind={row.original.kind} position={table.getRowModel().rows.indexOf(row) + 1} sides={sides} />
		),
	};
	const dataColumns = diff.columns.map(
		(column, index): ColumnDef<GridRow> => ({
			id: column,
			accessorFn: (gridRow) => shownValue(gridRow.row, index),
			sortingFn: (left, right) =>
				compareCells(shownValue(left.original.row, index), shownValue(right.original.row, index)),
			cell: ({ row }) => (
				<DiffCell row={row.original.row} index={index} isMissingColumn={diff.missingColumns.includes(column)} />
			),
		}),
	);
	return [gutterColumn, ...dataColumns];
}

/** The row number, as in a spreadsheet, or the mark of a row that differs between the two sides. */
function RowGutter({ kind, position, sides }: { kind: RowKind; position: number; sides: DiffSides }) {
	const marker = ROW_MARKERS[kind];
	return (
		<span
			className={cn(
				'block text-center font-sans text-[10px] tabular-nums',
				marker ? 'text-xs font-bold' : 'text-muted-foreground/70',
			)}
			title={describeRowKind(kind, sides)}
		>
			{marker || position}
		</span>
	);
}

function DiffCell({ row, index, isMissingColumn }: { row: TestDataDiffRow; index: number; isMissingColumn: boolean }) {
	const actual = row.actual?.[index] ?? null;
	const expected = row.expected?.[index] ?? null;
	const status: CellStatus | null = row.statuses?.[index] ?? null;
	const alignment = typeof shownValue(row, index) === 'number' ? 'text-right' : undefined;
	if (isMissingColumn && row.expected) {
		return <CellValue value={expected} className={cn('block text-red-700 dark:text-red-400', alignment)} />;
	}
	if (status === 'differ') {
		return (
			<span className={cn('block', alignment)}>
				<span className='mr-1 rounded-sm bg-red-500/15 px-0.5 text-red-700 line-through dark:text-red-400'>
					<CellValue value={expected} />
				</span>
				<span className='rounded-sm bg-green-500/15 px-0.5 text-green-700 dark:text-green-400'>
					<CellValue value={actual} />
				</span>
			</span>
		);
	}
	if (status === 'close') {
		return (
			<span
				className={cn('-mx-1.5 -my-0.5 block bg-amber-500/10 px-1.5 py-0.5', alignment)}
				title='Close enough to pass'
			>
				<CellValue value={actual} />
				<sup className='ml-1 text-[9px] text-amber-700 dark:text-amber-400'>
					≈<CellValue value={expected} />
				</sup>
			</span>
		);
	}
	return <CellValue value={shownValue(row, index)} className={cn('block', alignment)} />;
}

function CellValue({ value, className }: { value: Cell; className?: string }) {
	if (value === null) {
		return <span className={cn('text-muted-foreground/70 italic', className)}>null</span>;
	}
	return <span className={className}>{String(value)}</span>;
}

function shownValue(row: TestDataDiffRow, index: number): Cell {
	return row.actual?.[index] ?? row.expected?.[index] ?? null;
}

/** Orders numbers by value and the rest as text, with empty cells last. */
function compareCells(left: Cell, right: Cell): number {
	if (left === null || right === null) {
		return left === right ? 0 : left === null ? 1 : -1;
	}
	if (typeof left === 'number' && typeof right === 'number') {
		return left - right;
	}
	return String(left).localeCompare(String(right), undefined, { numeric: true });
}

function rowKind(row: TestDataDiffRow): RowKind {
	if (!row.actual) {
		return 'missing';
	}
	if (!row.expected) {
		return 'extra';
	}
	return row.statuses?.every((status) => status !== 'differ') ? 'match' : 'differ';
}

function describeRowKind(kind: RowKind, sides: DiffSides): string | undefined {
	switch (kind) {
		case 'missing':
			return `Only on ${sides.removed}`;
		case 'extra':
			return `Only on ${sides.added}`;
		case 'differ':
			return `Changed: ${sides.removed} struck out, then ${sides.added}`;
		case 'match':
			return undefined;
	}
}

/** What the grid does not show: columns left out of the comparison, and rows past the stored ones. */
function listDiffNotes(diff: TestDataDiff, sides: DiffSides): string[] {
	const notes: string[] = [];
	if (diff.extraColumns.length > 0) {
		notes.push(`Not compared: ${diff.extraColumns.join(', ')}, only on ${sides.added}.`);
	}
	if (diff.isTruncated) {
		notes.push(
			`First rows only, out of ${diff.expectedRowCount} on ${sides.removed} and ${diff.actualRowCount} on ${sides.added}.`,
		);
	}
	return notes;
}
