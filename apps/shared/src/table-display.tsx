import { memo, type ReactNode, useEffect, useMemo, useState } from 'react';

import { type ClassNameMerger, joinClassNames } from './class-names';
import type { DateFormatSettings } from './date';
import {
	formatCellValue,
	formatColumnLabel,
	isNumericColumn,
	type SortDirection,
	sortTableRows,
} from './story-table-utils';

type TableRow = Record<string, unknown>;

export interface TablePaginationProps {
	totalRows: number;
	pageIndex: number;
	pageSize: number;
	pageCount: number;
	onPageChange: (page: number) => void;
	onPageSizeChange: (size: number) => void;
}

export interface TableDisplayProps {
	data: TableRow[];
	columns?: string[];
	columnLabels?: Record<string, string>;
	title?: string;
	className?: string;
	tableContainerClassName?: string;
	emptyLabel?: string;
	showRowCount?: boolean;
	maxRowsBeforePagination?: number;
	compactFooter?: boolean;
	cellBackground?: (column: string, value: unknown) => string | undefined;
	humanizeColumnLabels?: boolean;
	dateFormat?: DateFormatSettings | null;
	renderPagination: (pagination: TablePaginationProps & { compact: boolean }) => ReactNode;
	cn?: ClassNameMerger;
}

type Sort = { column: string; direction: SortDirection };

/** `nao-table-display__*` classes let surfaces without Tailwind (sandboxed custom stories) style the same markup. */
export const TableDisplay = memo(function TableDisplay({
	data,
	columns,
	columnLabels,
	title,
	className,
	tableContainerClassName,
	emptyLabel = 'No rows returned',
	showRowCount = true,
	maxRowsBeforePagination = 100,
	compactFooter = false,
	cellBackground,
	humanizeColumnLabels = false,
	dateFormat,
	renderPagination,
	cn = joinClassNames,
}: TableDisplayProps) {
	const resolvedColumns = useMemo(
		() => (columns && columns.length > 0 ? columns : inferColumns(data)),
		[columns, data],
	);
	const numericColumns = useMemo(
		() => new Set(resolvedColumns.filter((column) => isNumericColumn(data, column))),
		[data, resolvedColumns],
	);
	const hasRows = data.length > 0;
	const showPagination = hasRows && data.length > maxRowsBeforePagination;

	const columnMinWidths = useMemo(
		() => computeColumnMinWidths(data, resolvedColumns, dateFormat),
		[data, resolvedColumns, dateFormat],
	);

	const [pageIndex, setPageIndex] = useState(0);
	const [pageSize, setPageSize] = useState(maxRowsBeforePagination);
	const [sort, setSort] = useState<Sort | null>(null);

	useEffect(() => setPageIndex(0), [data]);

	const activeSort = sort && resolvedColumns.includes(sort.column) ? sort : null;
	const sortedData = useMemo(
		() => (activeSort ? sortTableRows(data, activeSort.column, activeSort.direction) : data),
		[data, activeSort],
	);

	const pageCount = Math.ceil(sortedData.length / pageSize);
	const pageData = useMemo(
		() => (showPagination ? sortedData.slice(pageIndex * pageSize, (pageIndex + 1) * pageSize) : sortedData),
		[sortedData, pageIndex, pageSize, showPagination],
	);

	function toggleSort(column: string) {
		setPageIndex(0);
		setSort(nextSort(activeSort, column));
	}

	function columnLabel(column: string) {
		return columnLabels?.[column] ?? (humanizeColumnLabels ? formatColumnLabel(column) : column);
	}

	return (
		<div className={cn('nao-table-display flex min-h-0 flex-col', className)}>
			{title ? <span className='nao-table-display__title text-sm font-medium'>{title}</span> : null}

			<div
				className={cn(
					'nao-table-display__scroll overflow-auto border-t bg-background min-h-0',
					tableContainerClassName,
				)}
			>
				<table className='w-full min-w-max border-collapse text-xs'>
					<thead className='sticky top-0 z-10 border-b bg-panel'>
						<tr>
							<th className='nao-table-display__index shadow-[inset_-1px_0_0_0_var(--border)] last:shadow-none px-3 py-2 text-center font-medium whitespace-nowrap text-foreground w-4' />
							{resolvedColumns.map((column) => {
								const alignRight = numericColumns.has(column);
								const sortDirection = activeSort?.column === column ? activeSort.direction : null;
								return (
									<th
										key={column}
										aria-sort={
											sortDirection
												? sortDirection === 'asc'
													? 'ascending'
													: 'descending'
												: 'none'
										}
										className={cn(
											'shadow-[inset_-1px_0_0_0_var(--border)] last:shadow-none px-3 py-2 font-medium whitespace-nowrap text-foreground',
											alignRight && 'nao-table-display__numeric text-right tabular-nums',
										)}
									>
										<button
											type='button'
											onClick={() => toggleSort(column)}
											className='group flex w-full cursor-pointer items-center justify-between gap-3'
										>
											<span className={cn(alignRight && 'ml-auto')}>{columnLabel(column)}</span>
											<SortIndicator direction={sortDirection} cn={cn} />
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
									<td className='nao-table-display__index shadow-[inset_-1px_0_0_0_var(--border)] last:shadow-none px-3 py-1 align-top font-mono text-[11px] leading-5 whitespace-nowrap text-center w-4 bg-panel'>
										<span className='px-1 py-2 font-[Geist] font-medium text-foreground'>
											{pageIndex * pageSize + rowIndex + 1}
										</span>
									</td>
									{resolvedColumns.map((column) => {
										const value = row[column];
										const isNull = value === null || value === undefined;
										const background = cellBackground?.(column, value);
										return (
											<td
												key={`${rowIndex}-${column}`}
												style={{
													minWidth: columnMinWidths[column],
													...(background ? { backgroundColor: background } : {}),
												}}
												className={cn(
													'nao-table-display__cell shadow-[inset_-1px_0_0_0_var(--border)] last:shadow-none px-3 py-1 align-top font-mono text-[11px] leading-5 whitespace-nowrap',
													numericColumns.has(column) &&
														'nao-table-display__numeric text-right tabular-nums',
												)}
											>
												{isNull ? (
													<span className='nao-table-display__null italic text-muted-foreground/60'>
														NULL
													</span>
												) : (
													formatCellValue(value, dateFormat)
												)}
											</td>
										);
									})}
								</tr>
							))
						) : (
							<tr>
								<td
									colSpan={resolvedColumns.length + 1}
									className='nao-table-display__empty px-3 py-6 text-center text-sm text-muted-foreground'
								>
									{emptyLabel}
								</td>
							</tr>
						)}
					</tbody>
				</table>
			</div>

			{showPagination ? (
				renderPagination({
					compact: compactFooter,
					totalRows: data.length,
					pageIndex,
					pageSize,
					pageCount,
					onPageChange: setPageIndex,
					onPageSizeChange: (size) => {
						setPageSize(size);
						setPageIndex(0);
					},
				})
			) : showRowCount ? (
				<div
					className={cn(
						'nao-table-display__row-count flex px-4 py-2 border-t',
						compactFooter ? 'justify-start' : 'justify-end',
					)}
				>
					<span className={cn('text-muted-foreground', compactFooter ? 'text-xs' : 'text-sm')}>
						{data.length} rows
					</span>
				</div>
			) : null}
		</div>
	);
});

function SortIndicator({ direction, cn }: { direction: SortDirection | null; cn: ClassNameMerger }) {
	return (
		<span className='nao-table-display__sort inline-flex shrink-0 flex-col -space-y-1'>
			<ChevronIcon
				path='m18 15-6-6-6 6'
				className={cn(
					'size-3',
					direction === 'asc'
						? 'nao-table-display__sort--active text-foreground'
						: 'text-muted-foreground/50',
				)}
			/>
			<ChevronIcon
				path='m6 9 6 6 6-6'
				className={cn(
					'size-3',
					direction === 'desc'
						? 'nao-table-display__sort--active text-foreground'
						: 'text-muted-foreground/50',
				)}
			/>
		</span>
	);
}

/** Same glyphs as lucide's ChevronUp/ChevronDown, inlined so shared code does not depend on an icon package. */
function ChevronIcon({ path, className }: { path: string; className: string }) {
	return (
		<svg
			xmlns='http://www.w3.org/2000/svg'
			viewBox='0 0 24 24'
			fill='none'
			stroke='currentColor'
			strokeWidth='2'
			strokeLinecap='round'
			strokeLinejoin='round'
			aria-hidden='true'
			className={className}
		>
			<path d={path} />
		</svg>
	);
}

function nextSort(current: Sort | null, column: string): Sort | null {
	if (!current || current.column !== column) {
		return { column, direction: 'asc' };
	}
	if (current.direction === 'asc') {
		return { column, direction: 'desc' };
	}
	return null;
}

function computeColumnMinWidths(
	data: TableRow[],
	columns: string[],
	dateFormat?: DateFormatSettings | null,
): Record<string, string> {
	const widths: Record<string, string> = {};
	for (const column of columns) {
		let maxChars = 0;
		for (const row of data) {
			const chars = formatCellValue(row[column], dateFormat).length;
			if (chars > maxChars) {
				maxChars = chars;
			}
		}
		widths[column] = `calc(${maxChars}ch + 1.5rem)`;
	}
	return widths;
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
