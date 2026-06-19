import { formatCellValue, isNumericColumn } from '@nao/shared/story-table-utils';
import { useEffect, useMemo, useState } from 'react';
import { TablePagination } from '@/components/ui/table-pagination';
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
}: TableDisplayProps) {
	const resolvedColumns = columns && columns.length > 0 ? columns : inferColumns(data);
	const numericColumns = new Set(resolvedColumns.filter((column) => isNumericColumn(data, column)));
	const hasRows = data.length > 0;
	const showPagination = hasRows && data.length > maxRowsBeforePagination;

	const [pageIndex, setPageIndex] = useState(0);
	const [pageSize, setPageSize] = useState(maxRowsBeforePagination);

	useEffect(() => setPageIndex(0), [data]);

	const pageCount = Math.ceil(data.length / pageSize);
	const pageData = useMemo(
		() => (showPagination ? data.slice(pageIndex * pageSize, (pageIndex + 1) * pageSize) : data),
		[data, pageIndex, pageSize, showPagination],
	);

	return (
		<div className={cn('flex min-h-0 flex-col', className)}>
			{title ? <span className='text-sm font-medium'>{title}</span> : null}

			<div className={cn('overflow-auto border-t bg-background min-h-0', tableContainerClassName)}>
				<table className='w-full min-w-max border-collapse text-xs'>
					<thead className='sticky top-0 z-10 border-b bg-panel'>
						<tr>
							<th className='shadow-[inset_-1px_0_0_0_var(--border)] last:shadow-none px-3 py-2 text-center font-medium whitespace-nowrap text-foreground w-4'>
								1
							</th>
							{resolvedColumns.map((column) => (
								<th
									key={column}
									className={cn(
										'shadow-[inset_-1px_0_0_0_var(--border)] last:shadow-none px-3 py-2 text-left font-medium whitespace-nowrap text-foreground',
										numericColumns.has(column) && 'text-right tabular-nums',
									)}
								>
									{column}
								</th>
							))}
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
											{pageIndex * pageSize + rowIndex + 2}
										</span>
									</td>
									{resolvedColumns.map((column) => {
										const value = row[column];
										const isNull = value === null || value === undefined;
										return (
											<td
												key={`${rowIndex}-${column}`}
												className={cn(
													'shadow-[inset_-1px_0_0_0_var(--border)] last:shadow-none px-3 py-1 align-top font-mono text-[11px] leading-5 whitespace-nowrap',
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
