import { computeColumnRange, isConditionalFormatRule, resolveCellBackground } from '@nao/shared/conditional-formatting';
import { formatCellValue, formatColumnLabel, isNumericColumn, sortTableRows } from '@nao/shared/story-table-utils';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type { ColumnConditionalFormats, ColumnRange, ConditionalFormatRule } from '@nao/shared/conditional-formatting';
import type { SortDirection } from '@nao/shared/story-table-utils';
import { TablePagination } from '@/components/ui/table-pagination';
import { useDateFormat } from '@/hooks/use-date-format';
import { TablePaginationCompact } from '@/components/ui/table-pagination-compact';
import { cn } from '@/lib/utils';

type TableRow = Record<string, unknown>;

interface TableDisplayProps {
	data: TableRow[];
	columns?: string[];
	title?: string;
	className?: string;
	tableContainerClassName?: string;
	emptyLabel?: string;
	showRowCount?: boolean;
	maxRowsBeforePagination?: number;
	compactFooter?: boolean;
	conditionalFormats?: ColumnConditionalFormats;
	humanizeColumnLabels?: boolean;
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
	compactFooter = false,
	conditionalFormats,
	humanizeColumnLabels = false,
}: TableDisplayProps) {
	const dateFormat = useDateFormat();
	const resolvedColumns = columns && columns.length > 0 ? columns : inferColumns(data);
	const numericColumns = new Set(resolvedColumns.filter((column) => isNumericColumn(data, column)));
	const hasRows = data.length > 0;
	const showPagination = hasRows && data.length > maxRowsBeforePagination;

	const columnRanges = useMemo(
		() => computeFormattedColumnRanges(data, conditionalFormats),
		[data, conditionalFormats],
	);

	const [pageIndex, setPageIndex] = useState(0);
	const [pageSize, setPageSize] = useState(maxRowsBeforePagination);
	const [sort, setSort] = useState<{ column: string; direction: SortDirection } | null>(null);

	useEffect(() => setPageIndex(0), [data]);

	const sortedData = useMemo(() => (sort ? sortTableRows(data, sort.column, sort.direction) : data), [data, sort]);

	const pageCount = Math.ceil(sortedData.length / pageSize);
	const pageData = useMemo(
		() => (showPagination ? sortedData.slice(pageIndex * pageSize, (pageIndex + 1) * pageSize) : sortedData),
		[sortedData, pageIndex, pageSize, showPagination],
	);

	function toggleSort(column: string) {
		setPageIndex(0);
		setSort((current) => {
			if (!current || current.column !== column) {
				return { column, direction: 'asc' };
			}
			if (current.direction === 'asc') {
				return { column, direction: 'desc' };
			}
			return null;
		});
	}

	return (
		<div className={cn('flex min-h-0 flex-col', className)}>
			{title ? <span className='text-sm font-medium'>{title}</span> : null}

			<div className={cn('overflow-auto border-t bg-background min-h-0', tableContainerClassName)}>
				<table className='w-full min-w-max border-collapse text-xs'>
					<thead className='sticky top-0 z-10 border-b bg-panel'>
						<tr>
							<th className='shadow-[inset_-1px_0_0_0_var(--border)] last:shadow-none px-3 py-2 text-center font-medium whitespace-nowrap text-foreground w-4' />
							{resolvedColumns.map((column) => {
								const alignRight = numericColumns.has(column);
								const sortDirection = sort?.column === column ? sort.direction : null;
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
											alignRight && 'text-right tabular-nums',
										)}
									>
										<button
											type='button'
											onClick={() => toggleSort(column)}
											className='group flex w-full cursor-pointer items-center justify-between gap-3'
										>
											<span className={cn(alignRight && 'ml-auto')}>
												{humanizeColumnLabels ? formatColumnLabel(column) : column}
											</span>
											<SortIndicator direction={sortDirection} />
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
									<td className='shadow-[inset_-1px_0_0_0_var(--border)] last:shadow-none px-3 py-1 align-top font-mono text-[11px] leading-5 whitespace-nowrap text-center w-4 bg-panel'>
										<span className='px-1 py-2 font-[Geist] font-medium text-foreground'>
											{pageIndex * pageSize + rowIndex + 1}
										</span>
									</td>
									{resolvedColumns.map((column) => {
										const value = row[column];
										const isNull = value === null || value === undefined;
										const background = resolveColumnCellBackground(
											conditionalFormats?.[column],
											value,
											columnRanges[column] ?? null,
										);
										return (
											<td
												key={`${rowIndex}-${column}`}
												style={background ? { backgroundColor: background } : undefined}
												className={cn(
													'shadow-[inset_-1px_0_0_0_var(--border)] last:shadow-none px-3 py-1 align-top font-mono text-[11px] leading-5 whitespace-nowrap',
													numericColumns.has(column) && 'text-right tabular-nums',
												)}
											>
												{isNull ? (
													<span className='italic text-muted-foreground/60'>NULL</span>
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
									className='px-3 py-6 text-center text-sm text-muted-foreground'
								>
									{emptyLabel}
								</td>
							</tr>
						)}
					</tbody>
				</table>
			</div>

			{showPagination ? (
				compactFooter ? (
					<TablePaginationCompact
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
				) : (
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
				)
			) : showRowCount ? (
				<div className={cn('flex px-4 py-2 border-t', compactFooter ? 'justify-start' : 'justify-end')}>
					<span className={cn('text-muted-foreground', compactFooter ? 'text-xs' : 'text-sm')}>
						{data.length} rows
					</span>
				</div>
			) : null}
		</div>
	);
}

function SortIndicator({ direction }: { direction: SortDirection | null }) {
	return (
		<span className='inline-flex shrink-0 flex-col -space-y-1'>
			<ChevronUp className={cn('size-3', direction === 'asc' ? 'text-foreground' : 'text-muted-foreground/50')} />
			<ChevronDown
				className={cn('size-3', direction === 'desc' ? 'text-foreground' : 'text-muted-foreground/50')}
			/>
		</span>
	);
}

function computeFormattedColumnRanges(
	data: TableRow[],
	conditionalFormats?: ColumnConditionalFormats,
): Record<string, ColumnRange | null> {
	if (!conditionalFormats) {
		return {};
	}

	const ranges: Record<string, ColumnRange | null> = {};
	for (const [column, rule] of Object.entries(conditionalFormats)) {
		if (isConditionalFormatRule(rule) && rule.type === 'color-scale') {
			ranges[column] = computeColumnRange(data, column);
		}
	}
	return ranges;
}

function resolveColumnCellBackground(
	rule: ConditionalFormatRule | undefined,
	value: unknown,
	range: ColumnRange | null,
): string | undefined {
	return isConditionalFormatRule(rule) ? resolveCellBackground(rule, value, range) : undefined;
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
