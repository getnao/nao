import { computeColumnRange, DEFAULT_THRESHOLD_COLOR, resolveCellBackground } from '@nao/shared/conditional-formatting';
import { formatCellValue, isNumericColumn } from '@nao/shared/story-table-utils';
import { Ban, Palette, SlidersHorizontal } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type { ColumnConditionalFormats, ColumnRange, ConditionalFormatRule } from '@nao/shared/conditional-formatting';
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
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
	onConditionalFormatsChange?: (formats: ColumnConditionalFormats) => void;
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
	onConditionalFormatsChange,
}: TableDisplayProps) {
	const dateFormat = useDateFormat();
	const resolvedColumns = columns && columns.length > 0 ? columns : inferColumns(data);
	const numericColumns = new Set(resolvedColumns.filter((column) => isNumericColumn(data, column)));
	const hasRows = data.length > 0;
	const showPagination = hasRows && data.length > maxRowsBeforePagination;
	const isEditable = Boolean(onConditionalFormatsChange);

	const columnRanges = useMemo(
		() => computeFormattedColumnRanges(data, conditionalFormats),
		[data, conditionalFormats],
	);

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
									<span className='group inline-flex items-center gap-1'>
										{column}
										{isEditable && numericColumns.has(column) ? (
											<ColumnFormatMenu
												column={column}
												data={data}
												isActive={Boolean(conditionalFormats?.[column])}
												onApply={(rule) =>
													onConditionalFormatsChange?.(
														upsertColumnFormat(conditionalFormats, column, rule),
													)
												}
												onClear={() =>
													onConditionalFormatsChange?.(
														removeColumnFormat(conditionalFormats, column),
													)
												}
											/>
										) : null}
									</span>
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

function ColumnFormatMenu({
	column,
	data,
	isActive,
	onApply,
	onClear,
}: {
	column: string;
	data: TableRow[];
	isActive: boolean;
	onApply: (rule: ConditionalFormatRule) => void;
	onClear: () => void;
}) {
	return (
		<DropdownMenu>
			<DropdownMenuTrigger
				aria-label={`Conditional formatting for ${column}`}
				className={cn(
					'rounded p-0.5 text-muted-foreground/50 opacity-0 transition group-hover:opacity-100 hover:bg-accent hover:text-foreground focus:opacity-100 data-[state=open]:opacity-100',
					isActive && 'text-foreground opacity-100',
				)}
			>
				<SlidersHorizontal className='size-3' />
			</DropdownMenuTrigger>
			<DropdownMenuContent align='end' className='min-w-44'>
				<DropdownMenuItem onSelect={() => onApply({ type: 'color-scale' })}>
					<Palette className='size-3.5' />
					Color scale
				</DropdownMenuItem>
				<DropdownMenuItem onSelect={() => onApply(buildAboveAverageRule(data, column))}>
					<SlidersHorizontal className='size-3.5' />
					Highlight above average
				</DropdownMenuItem>
				<DropdownMenuItem variant='destructive' disabled={!isActive} onSelect={() => onClear()}>
					<Ban className='size-3.5' />
					Clear formatting
				</DropdownMenuItem>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}

function buildAboveAverageRule(data: TableRow[], column: string): ConditionalFormatRule {
	const values = data
		.map((row) => row[column])
		.filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
	const average = values.length > 0 ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
	return { type: 'threshold', operator: '>=', value: average, color: DEFAULT_THRESHOLD_COLOR };
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
		if (rule.type === 'color-scale') {
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
	return rule ? resolveCellBackground(rule, value, range) : undefined;
}

function upsertColumnFormat(
	formats: ColumnConditionalFormats | undefined,
	column: string,
	rule: ConditionalFormatRule,
): ColumnConditionalFormats {
	return { ...(formats ?? {}), [column]: rule };
}

function removeColumnFormat(formats: ColumnConditionalFormats | undefined, column: string): ColumnConditionalFormats {
	const next = { ...(formats ?? {}) };
	delete next[column];
	return next;
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
