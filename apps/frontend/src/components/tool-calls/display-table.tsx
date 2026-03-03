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
}

export function TableDisplay({
	data,
	columns,
	title,
	className,
	tableContainerClassName,
	emptyLabel = 'No rows returned',
	showRowCount = true,
}: TableDisplayProps) {
	const resolvedColumns = columns && columns.length > 0 ? columns : inferColumns(data);
	const numericColumns = new Set(resolvedColumns.filter((column) => hasNumericValueInColumn(data, column)));
	const hasRows = data.length > 0;

	return (
		<div className={cn('flex min-h-0 flex-col gap-2', className)}>
			{title ? <span className='text-sm font-medium'>{title}</span> : null}

			<div className={cn('overflow-auto rounded-lg border bg-card/50', tableContainerClassName)}>
				<table className='w-full min-w-max border-collapse text-xs'>
					<thead className='sticky top-0 z-10 border-b bg-panel'>
						<tr>
							{resolvedColumns.map((column) => (
								<th
									key={column}
									className={cn(
										'px-3 py-2 text-left font-medium whitespace-nowrap text-muted-foreground last:border-r-0',
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
							data.map((row, rowIndex) => (
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
													isNumberValue(value) && 'text-right tabular-nums',
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

			{showRowCount ? (
				<div className='flex justify-end px-1'>
					<span className='text-xs text-muted-foreground'>{data.length} rows</span>
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

function isNumberValue(value: unknown): value is number {
	return typeof value === 'number' && Number.isFinite(value);
}

function hasNumericValueInColumn(data: TableRow[], column: string): boolean {
	return data.some((row) => isNumberValue(row[column]));
}

function formatCellValue(value: unknown): string {
	if (typeof value === 'string') {
		return value;
	}
	if (typeof value === 'number') {
		return Number.isFinite(value) ? String(value) : 'NULL';
	}
	if (typeof value === 'boolean') {
		return value ? 'TRUE' : 'FALSE';
	}
	if (typeof value === 'object') {
		try {
			return JSON.stringify(value);
		} catch {
			return String(value);
		}
	}
	return String(value);
}
