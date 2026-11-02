import { useState } from 'react';

import type { TestDataDiff, TestDataDiffRow } from '@/components/settings/test-run-types';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';

type Cell = NonNullable<TestDataDiffRow['expected']>[number];
type CellStatus = NonNullable<TestDataDiffRow['statuses']>[number];
type RowKind = 'match' | 'differ' | 'missing' | 'extra';

const ROW_KIND_DISPLAY: Record<RowKind, { marker: string; label: string; className: string; chipClassName: string }> = {
	match: {
		marker: '',
		label: 'matching',
		className: '',
		chipClassName: 'bg-green-500/10 text-green-700 dark:text-green-400',
	},
	differ: {
		marker: '≠',
		label: 'different',
		className: '',
		chipClassName: 'bg-red-500/10 text-red-700 dark:text-red-400',
	},
	missing: {
		marker: '−',
		label: 'missing from the answer',
		className: 'bg-red-500/5 text-red-700/80 dark:text-red-400/80',
		chipClassName: 'bg-red-500/10 text-red-700 dark:text-red-400',
	},
	extra: {
		marker: '+',
		label: 'not expected',
		className: 'bg-amber-500/5 text-amber-700/90 dark:text-amber-400/90',
		chipClassName: 'bg-amber-500/10 text-amber-700 dark:text-amber-400',
	},
};

const ROW_KINDS: RowKind[] = ['match', 'differ', 'missing', 'extra'];

/** The agent's rows next to the reference ones, cell by cell, as the verdict compared them. */
export function TestDataDiffView({ diff }: { diff: TestDataDiff }) {
	const counts = countRowKinds(diff.rows);
	const hasDifferences = counts.differ + counts.missing + counts.extra > 0;
	const [onlyDifferences, setOnlyDifferences] = useState(false);
	const rows = onlyDifferences ? diff.rows.filter((row) => rowKind(row) !== 'match') : diff.rows;

	return (
		<div className='flex min-w-0 flex-col gap-2 text-xs'>
			<div className='flex flex-wrap items-center gap-1.5'>
				{ROW_KINDS.filter((kind) => counts[kind] > 0).map((kind) => (
					<span
						key={kind}
						className={cn('rounded-md px-1.5 py-0.5 font-medium', ROW_KIND_DISPLAY[kind].chipClassName)}
					>
						{counts[kind]} {ROW_KIND_DISPLAY[kind].label}
					</span>
				))}
				<span className='text-muted-foreground'>
					Reference {pluralizeRows(diff.expectedRowCount)} · answer {pluralizeRows(diff.actualRowCount)}
				</span>
				{hasDifferences && counts.match > 0 && (
					<label className='ml-auto flex cursor-pointer items-center gap-1.5 text-muted-foreground'>
						<Switch
							checked={onlyDifferences}
							onCheckedChange={setOnlyDifferences}
							aria-label='Only show the differences'
						/>
						Only differences
					</label>
				)}
			</div>

			{diff.missingColumns.length > 0 && (
				<p className='text-red-700 dark:text-red-400'>
					The answer has no <span className='font-mono'>{diff.missingColumns.join(', ')}</span> column
					{diff.missingColumns.length === 1 ? '' : 's'}.
				</p>
			)}
			{diff.extraColumns.length > 0 && (
				<p className='text-muted-foreground'>
					The answer also has <span className='font-mono'>{diff.extraColumns.join(', ')}</span>, which the
					test does not check.
				</p>
			)}

			<div className='max-h-80 overflow-auto rounded-md border bg-background'>
				<table className='w-full border-collapse font-mono'>
					<thead className='sticky top-0 z-10 bg-muted'>
						<tr>
							<th className='w-6 border-b' aria-label='Difference' />
							{diff.columns.map((column) => (
								<th
									key={column}
									className={cn(
										'border-b px-2 py-1 text-left font-medium whitespace-nowrap text-foreground',
										diff.missingColumns.includes(column) && 'text-red-700 dark:text-red-400',
									)}
								>
									{column}
								</th>
							))}
						</tr>
					</thead>
					<tbody>
						{rows.map((row, index) => (
							<DiffRow key={index} row={row} columnCount={diff.columns.length} />
						))}
						{rows.length === 0 && (
							<tr>
								<td
									colSpan={diff.columns.length + 1}
									className='px-2 py-3 text-center font-sans text-muted-foreground'
								>
									No rows.
								</td>
							</tr>
						)}
					</tbody>
				</table>
			</div>

			<div className='flex flex-wrap items-center gap-x-3 gap-y-1 text-muted-foreground'>
				{hasDifferences && (
					<span>
						<span className='font-mono text-red-700 dark:text-red-400'>≠</span> the answer, with the
						reference value below · <span className='font-mono text-red-700 dark:text-red-400'>−</span> row
						the answer misses · <span className='font-mono text-amber-700 dark:text-amber-400'>+</span> row
						the reference does not have
					</span>
				)}
				{diff.isTruncated && <span>Only the first rows of each side were kept.</span>}
			</div>
		</div>
	);
}

function DiffRow({ row, columnCount }: { row: TestDataDiffRow; columnCount: number }) {
	const kind = rowKind(row);
	const display = ROW_KIND_DISPLAY[kind];
	const values = row.actual ?? row.expected ?? [];
	return (
		<tr className={cn('border-b last:border-b-0', display.className)} title={rowTitle(kind)}>
			<td
				className={cn(
					'px-1.5 text-center font-semibold',
					kind === 'extra' ? 'text-amber-700 dark:text-amber-400' : 'text-red-700 dark:text-red-400',
				)}
			>
				{display.marker}
			</td>
			{Array.from({ length: columnCount }, (_, index) =>
				row.statuses ? (
					<ComparedCell
						key={index}
						actual={row.actual?.[index] ?? null}
						expected={row.expected?.[index] ?? null}
						status={row.statuses[index]}
					/>
				) : (
					<td key={index} className='px-2 py-1 whitespace-nowrap'>
						<CellValue value={values[index] ?? null} />
					</td>
				),
			)}
		</tr>
	);
}

function ComparedCell({ actual, expected, status }: { actual: Cell; expected: Cell; status: CellStatus }) {
	if (status === 'match') {
		return (
			<td className='px-2 py-1 whitespace-nowrap'>
				<CellValue value={actual} />
			</td>
		);
	}
	const isClose = status === 'close';
	return (
		<td
			className={cn(
				'px-2 py-1 whitespace-nowrap',
				isClose ? 'bg-amber-500/10' : 'bg-red-500/10 text-red-700 dark:text-red-400',
			)}
			title={isClose ? 'Close enough to the reference to pass' : undefined}
		>
			<div className='flex flex-col leading-tight'>
				<CellValue value={actual} />
				<span className='text-[10px] text-muted-foreground'>
					{isClose ? '≈ ' : ''}
					<CellValue value={expected} />
				</span>
			</div>
		</td>
	);
}

function CellValue({ value }: { value: Cell }) {
	if (value === null) {
		return <span className='text-muted-foreground/70 italic'>null</span>;
	}
	return <>{String(value)}</>;
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

function countRowKinds(rows: TestDataDiffRow[]): Record<RowKind, number> {
	const counts: Record<RowKind, number> = { match: 0, differ: 0, missing: 0, extra: 0 };
	for (const row of rows) {
		counts[rowKind(row)]++;
	}
	return counts;
}

function rowTitle(kind: RowKind): string | undefined {
	if (kind === 'missing') {
		return 'The reference has this row, the answer does not';
	}
	if (kind === 'extra') {
		return 'The answer has this row, the reference does not';
	}
	return undefined;
}

function pluralizeRows(count: number): string {
	return `${count} row${count === 1 ? '' : 's'}`;
}
