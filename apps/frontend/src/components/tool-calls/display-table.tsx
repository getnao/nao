import { formatCellValue, inferColumnSortKind, isNumericColumn, sortRowsByColumn } from '@nao/shared/story-table-utils';
import { ChevronDown, ChevronsUpDown, ChevronUp } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type { ColumnSortKind, SortDirection } from '@nao/shared/story-table-utils';

import { TablePagination } from '@/components/ui/table-pagination';
import { cn } from '@/lib/utils';

type TableRow = Record<string, unknown>;

interface SortState {
	column: string;
	direction: SortDirection;
}

interface TableDisplayProps {
	data: TableRow[];
	columns?: string[];
	title?: string;
	className?: string;
	tableContainerClassName?: string;
	emptyLabel?: string;
	showRowCount?: boolean;
	maxRowsBeforePagination?: number;
}

export function TableDisplay({
	data,
	columns,
	title,
	className,
	tableContainerClassName,
	emptyLabel = 'No rows returned',
	showRowCount = true,
	maxRowsBeforePagination = 100,
}: TableDisplayProps) {
	const resolvedColumns = columns && columns.length > 0 ? columns : inferColumns(data);
	const numericColumns = new Set(resolvedColumns.filter((column) => isNumericColumn(data, column)));
	const sortKinds = useMemo(() => {
		const kinds = new Map<string, ColumnSortKind>();
		for (const column of resolvedColumns) {
			kinds.set(column, inferColumnSortKind(data, column));
		}
		return kinds;
	}, [data, resolvedColumns]);
	const hasRows = data.length > 0;
	const needsPagination = data.length > maxRowsBeforePagination;

	const [pageIndex, setPageIndex] = useState(0);
	const [pageSize, setPageSize] = useState(maxRowsBeforePagination);
	const [sort, setSort] = useState<SortState | null>(null);

	useEffect(() => {
		setPageIndex(0);
		setSort(null);
	}, [data]);

	const sortedData = useMemo(() => {
		if (!sort) {
			return data;
		}
		const kind = sortKinds.get(sort.column) ?? 'string';
		return sortRowsByColumn(data, sort.column, sort.direction, kind);
	}, [data, sort, sortKinds]);

	const pageCount = Math.ceil(sortedData.length / pageSize);
	const pageData = useMemo(
		() => (needsPagination ? sortedData.slice(pageIndex * pageSize, (pageIndex + 1) * pageSize) : sortedData),
		[sortedData, pageIndex, pageSize, needsPagination],
	);

	const toggleSort = (column: string) => {
		setSort((current) => nextSortState(current, column));
		setPageIndex(0);
	};

	return (
		<div className={cn('flex min-h-0 flex-col gap-2', className)}>
			{title ? <span className='text-sm font-medium'>{title}</span> : null}

			<div className={cn('overflow-auto rounded-lg border bg-card/50 min-h-0', tableContainerClassName)}>
				<table className='w-full min-w-max border-collapse text-xs'>
					<thead className='sticky top-0 z-10 border-b bg-panel'>
						<tr>
							{resolvedColumns.map((column) => {
								const isNumeric = numericColumns.has(column);
								const isSorted = sort?.column === column;
								const SortIcon = isSorted
									? sort.direction === 'asc'
										? ChevronUp
										: ChevronDown
									: ChevronsUpDown;
								return (
									<th
										key={column}
										className={cn(
											'px-3 py-2 font-medium whitespace-nowrap text-muted-foreground last:border-r-0',
											isNumeric ? 'text-right tabular-nums' : 'text-left',
										)}
										aria-sort={
											isSorted ? (sort.direction === 'asc' ? 'ascending' : 'descending') : 'none'
										}
									>
										<button
											type='button'
											onClick={() => toggleSort(column)}
											className={cn(
												'group inline-flex items-center gap-1 select-none hover:text-foreground focus-visible:outline-none focus-visible:text-foreground',
												isNumeric && 'flex-row-reverse',
											)}
										>
											<span>{column}</span>
											<SortIcon
												className={cn(
													'size-3 shrink-0 transition-opacity',
													isSorted ? 'opacity-100' : 'opacity-30 group-hover:opacity-70',
												)}
											/>
										</button>
									</th>
								);
							})}
						</tr>
					</thead>

					<tbody>
						{hasRows ? (
							pageData.map((row, rowIndex) => (
								<tr
									key={rowIndex}
									className='border-b last:border-b-0 border-border/50 bg-background  hover:bg-accent/30'
								>
									{resolvedColumns.map((column) => {
										const value = row[column];
										const isNull = value === null || value === undefined;
										return (
											<td
												key={`${rowIndex}-${column}`}
												className={cn(
													'border-border/40 px-3 py-1 align-top font-mono text-[11px] leading-5 whitespace-nowrap last:border-r-0',
													numericColumns.has(column) && 'text-right tabular-nums',
												)}
											>
												{isNull ? (
													<span className='italic text-muted-foreground/60'>NULL</span>
												) : (
													formatCellValue(value)
												)}
											</td>
										);
									})}
								</tr>
							))
						) : (
							<tr>
								<td
									colSpan={Math.max(resolvedColumns.length, 1)}
									className='px-3 py-6 text-center text-sm text-muted-foreground'
								>
									{emptyLabel}
								</td>
							</tr>
						)}
					</tbody>
				</table>
			</div>

			{needsPagination ? (
				<TablePagination
					totalRows={data.length}
					pageIndex={pageIndex}
					pageSize={pageSize}
					pageCount={pageCount}
					onPageChange={setPageIndex}
					onPageSizeChange={(size) => {
						setPageSize(size);
						setPageIndex(0);
					}}
				/>
			) : showRowCount ? (
				<div className='flex justify-end px-2'>
					<span className='text-sm text-muted-foreground'>{data.length} rows</span>
				</div>
			) : null}
		</div>
	);
}

function nextSortState(current: SortState | null, column: string): SortState | null {
	if (!current || current.column !== column) {
		return { column, direction: 'asc' };
	}
	if (current.direction === 'asc') {
		return { column, direction: 'desc' };
	}
	return null;
}

function inferColumns(data: TableRow[]): string[] {
	const seen = new Set<string>();
	const columns: string[] = [];

	for (const row of data) {
		for (const column of Object.keys(row)) {
			if (seen.has(column)) {
				continue;
			}
			seen.add(column);
			columns.push(column);
		}
	}

	return columns;
}
