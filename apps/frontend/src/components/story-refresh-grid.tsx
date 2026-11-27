import { useMemo, useState } from 'react';

import { formatDuration } from '@/lib/monitoring-format';
import { formatUsd } from '@/lib/story-monitoring-mock';
import { cn } from '@/lib/utils';

export type RefreshSchedule = 'every_5_min' | 'hourly' | 'every_6_hours' | 'weekdays' | 'daily';
type GridSchedule = 'every_5_min' | 'hourly';

type RunStatus = 'ok' | 'failed' | 'missed' | 'running';

interface Run {
	at: Date;
	status: RunStatus;
	trigger: 'schedule' | 'manual';
	durationMs: number;
	costUsd: number;
	error?: string;
}

interface Cell {
	key: string;
	start: Date;
	end: number;
	runs: Run[];
	isFuture: boolean;
	isNext?: boolean;
}

const NOW = new Date('2026-11-27T10:12:00Z');
const NEXT_RUN: Record<RefreshSchedule, Date> = {
	every_5_min: new Date('2026-11-27T10:15:00Z'),
	hourly: new Date('2026-11-27T11:00:00Z'),
	every_6_hours: new Date('2026-11-27T12:00:00Z'),
	weekdays: new Date('2026-11-27T12:00:00Z'),
	daily: new Date('2026-11-28T07:00:00Z'),
};
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const WAREHOUSE_ERROR = 'Snowflake warehouse COMPUTE_WH is suspended (code 000606).';
const SCHEDULE_LABELS: Record<RefreshSchedule, string> = {
	every_5_min: 'every 5 min',
	hourly: 'every hour',
	every_6_hours: '4 times a day',
	weekdays: 'weekdays at 9:00, 12:00 and 17:00',
	daily: 'every day at 7:00',
};

/** Sparse schedules fit every run of their window in the bar strip, so they get no grid. */
const STRIP_ONLY_WINDOWS: Partial<Record<RefreshSchedule, string>> = {
	every_6_hours: 'last 14 days',
	weekdays: 'last 4 weeks',
	daily: 'last 8 weeks',
};

export function StoryRefreshGrid({ schedule }: { schedule: RefreshSchedule }) {
	const stripWindow = STRIP_ONLY_WINDOWS[schedule];
	if (stripWindow) {
		return <StoryRefreshStrip schedule={schedule} window={stripWindow} />;
	}
	return <StoryRefreshSquares schedule={schedule as GridSchedule} />;
}

const STEPS = [
	{ id: 'orders_by_month', label: 'orders_by_month', kind: 'query' },
	{ id: 'fulfillment_rate', label: 'fulfillment_rate', kind: 'query' },
	{ id: 'order_value', label: 'order_value', kind: 'query' },
	{ id: 'status_mix', label: 'status_mix', kind: 'query' },
	{ id: 'narrative', label: 'Narrative rewrite', kind: 'llm' },
] as const;

type StepStatus = 'ok' | 'failed' | 'skipped' | 'missed';

interface RunStep {
	status: StepStatus;
	detail: string;
	error?: string;
}

const STEP_CLASSES: Record<StepStatus, string> = {
	ok: 'bg-emerald-500 dark:bg-emerald-500/80',
	failed: 'bg-destructive',
	skipped: 'bg-muted-foreground/20',
	missed: 'border border-dashed border-muted-foreground/60',
};

/** Sparse or uneven schedules: one duration bar per run; the steps of a run show in its detail. */
function StoryRefreshStrip({ schedule, window }: { schedule: RefreshSchedule; window: string }) {
	const runs = useMemo(() => buildMockRuns(schedule), [schedule]);
	const latestFailure = runs.map((run) => run.status).lastIndexOf('failed');
	const [selectedIndex, setSelectedIndex] = useState(latestFailure >= 0 ? latestFailure : runs.length - 1);
	const maxDuration = Math.max(...runs.map((run) => run.durationMs));
	const selected = runs[selectedIndex];

	return (
		<section className='flex flex-col gap-3 rounded-xl border p-3'>
			<RunHistoryHeader subtitle={`${SCHEDULE_LABELS[schedule]} · ${runs.length} runs · ${window}`} />
			<div className='grid grid-cols-1 gap-y-px'>
				<TreeColumns>
					{runs.map((run, index) => (
						<button
							key={run.at.getTime()}
							type='button'
							onClick={() => setSelectedIndex(index)}
							title={`${formatShort(run.at)} · ${run.status}${run.trigger === 'manual' ? ' · manual' : ''}`}
							className={cn(
								'flex h-12 items-end rounded-[2px]',
								index === selectedIndex && 'outline outline-2 outline-offset-1 outline-foreground',
							)}
						>
							<span
								className={cn(
									'w-full rounded-[2px]',
									BAR_CLASSES[run.status],
									run.status === 'missed' && 'h-full',
								)}
								style={
									run.status === 'missed'
										? undefined
										: { height: `${Math.max(10, (run.durationMs / maxDuration) * 100)}%` }
								}
							/>
						</button>
					))}
					<span className='flex h-12 items-end'>
						<span className='h-1/2 w-full rounded-[2px] border border-dashed border-primary' />
					</span>
				</TreeColumns>

				<TreeColumns>
					{runs.map((run, index) => (
						<span key={run.at.getTime()} className='relative h-5'>
							{run.trigger === 'manual' && (
								<ManualMark className='absolute top-0 left-1/2 -translate-x-1/2' />
							)}
							{stripTick(runs, index, schedule) && (
								<span className='absolute top-1.5 left-0 whitespace-nowrap text-[9px] text-muted-foreground tabular-nums'>
									{stripTick(runs, index, schedule)}
								</span>
							)}
						</span>
					))}
					<span />
				</TreeColumns>
			</div>
			<RunStepsDetail run={selected} />
		</section>
	);
}

/** A small caret under a run's column marks a refresh someone triggered by hand. */
function ManualMark({ className }: { className?: string }) {
	return (
		<span
			aria-label='Manual refresh'
			className={cn(
				'block size-0 border-x-[3px] border-b-[4px] border-x-transparent border-b-foreground',
				className,
			)}
		/>
	);
}

function TreeColumns({ children }: { children: React.ReactNode }) {
	return <div className='grid grid-flow-col auto-cols-fr gap-px'>{children}</div>;
}

/** One line per step; only a failed step adds its error under it. */
function RunStepsDetail({ run }: { run: Run }) {
	const steps = stepsOf(run);
	return (
		<div className='flex flex-col gap-1.5 rounded-lg bg-muted/40 px-3 py-2 text-xs'>
			<span>
				<span className='font-medium'>{formatShort(run.at)}</span> <RunFacts run={run} />
			</span>
			<ul className='flex flex-wrap gap-x-4 gap-y-1'>
				{STEPS.map((step) => {
					const runStep = steps[step.id];
					return (
						<li key={step.id} className='flex items-center gap-1.5'>
							<span className={cn('size-2 shrink-0 rounded-[1px]', STEP_CLASSES[runStep.status])} />
							<span className={cn(step.kind === 'query' && 'font-mono text-[11px]')}>{step.label}</span>
							<span className='text-muted-foreground'>{runStep.detail}</span>
						</li>
					);
				})}
			</ul>
			{STEPS.map((step) => steps[step.id].error)
				.filter(Boolean)
				.slice(0, 1)
				.map((error) => (
					<code
						key={error}
						className='rounded-md bg-destructive/10 px-2 py-1 whitespace-pre-wrap text-destructive'
					>
						{error}
					</code>
				))}
		</div>
	);
}

/** Which step broke follows from the run's error: a warehouse error stops at the first query, a timeout at the rewrite. */
function stepsOf(run: Run): Record<(typeof STEPS)[number]['id'], RunStep> {
	const seconds = (base: number) => `${(base + (run.at.getTime() % 7) * 0.3).toFixed(1)}s`;
	const ok = (base: number): RunStep => ({ status: 'ok', detail: seconds(base) });
	const steps = {
		orders_by_month: ok(2.1),
		fulfillment_rate: ok(1.4),
		order_value: ok(1.8),
		status_mix: ok(0.9),
		narrative: { status: 'ok', detail: `${seconds(9)} · ${Math.round(run.costUsd * 900)}k tokens` } as RunStep,
	};
	if (run.status === 'missed') {
		return Object.fromEntries(
			Object.keys(steps).map((key) => [key, { status: 'missed', detail: 'did not start' }]),
		) as typeof steps;
	}
	if (run.error?.includes('Snowflake')) {
		const skipped: RunStep = { status: 'skipped', detail: 'not run' };
		return {
			orders_by_month: { status: 'failed', detail: 'failed after 31s', error: run.error },
			fulfillment_rate: skipped,
			order_value: skipped,
			status_mix: skipped,
			narrative: skipped,
		};
	}
	if (run.error) {
		return { ...steps, narrative: { status: 'failed', detail: 'timed out after 60s', error: run.error } };
	}
	return steps;
}

function StoryRefreshSquares({ schedule }: { schedule: GridSchedule }) {
	const runs = useMemo(() => buildMockRuns(schedule), [schedule]);
	const layout = LAYOUTS[schedule];
	const nextRun = NEXT_RUN[schedule];
	const rows = useMemo(() => markNextRun(layout.buildRows(runs), nextRun), [runs, layout, nextRun]);
	const defaultCell = rows
		.flat()
		.filter((cell) => cell.runs.some((run) => run.status === 'failed'))
		.sort((left, right) => right.start.getTime() - left.start.getTime())[0];
	const [selectedKey, setSelectedKey] = useState<string | undefined>(defaultCell?.key);
	const selected = rows.flat().find((cell) => cell.key === selectedKey);

	return (
		<section className='flex flex-col gap-4 rounded-xl border p-4'>
			<RunHistoryHeader
				subtitle={`refreshes ${SCHEDULE_LABELS[schedule]} · one square per run · ${layout.window}`}
			/>

			<LatestRunsStrip runs={runs.slice(-72)} nextRun={nextRun} />

			<div className='flex flex-wrap gap-6'>
				<div className='flex flex-col gap-[3px]'>
					<div className='flex items-center gap-[3px]'>
						<span className='w-16 shrink-0' />
						{layout.columnLabels.map((label, index) => (
							<span
								key={index}
								className='w-3.5 shrink-0 text-center text-[9px] text-muted-foreground tabular-nums'
							>
								{label}
							</span>
						))}
					</div>
					{rows.map((row, rowIndex) => (
						<div key={row[0].key} className='flex items-center gap-[3px]'>
							<span className='w-16 shrink-0 text-[10px] text-muted-foreground tabular-nums'>
								{layout.rowLabel(row[0].start, rowIndex)}
							</span>
							{row.map((cell) => (
								<GridCell
									key={cell.key}
									cell={cell}
									isSelected={cell.key === selectedKey}
									onSelect={() => setSelectedKey(cell.key)}
								/>
							))}
						</div>
					))}
				</div>
				<div className='min-w-56 flex-1'>
					{selected?.runs.length === 1 ? (
						<RunStepsDetail run={selected.runs[0]} />
					) : (
						<CellDetail cell={selected} isDaily={false} />
					)}
				</div>
			</div>
		</section>
	);
}

function RunHistoryHeader({ subtitle }: { subtitle: string }) {
	return (
		<header className='flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2'>
			<h3 className='text-sm font-semibold'>
				Run history
				<span className='ml-2 text-xs font-normal text-muted-foreground'>{subtitle}</span>
			</h3>
			<div className='flex items-center gap-4'>
				<Legend aggregated={false} />
				<span className='flex items-center gap-1 text-xs text-muted-foreground'>
					<span className='rounded border px-1.5'>‹ older</span>
					<span className='rounded border px-1.5 opacity-40'>newer ›</span>
				</span>
			</div>
		</header>
	);
}

/** Date under the first run of every other day (4×/day) or of every Monday (daily). */
function stripTick(runs: Run[], index: number, schedule: RefreshSchedule): string | null {
	const run = runs[index];
	const previous = runs[index - 1];
	const isNewDay = !previous || previous.at.getUTCDate() !== run.at.getUTCDate();
	if (!isNewDay || run.trigger === 'manual') {
		return null;
	}
	const shouldLabel =
		schedule === 'daily' || schedule === 'weekdays' ? run.at.getUTCDay() === 1 : run.at.getUTCDate() % 2 === 0;
	return shouldLabel ? formatDay(run.at) : null;
}

interface GridLayout {
	window: string;
	columnLabels: string[];
	rowLabel: (start: Date, rowIndex: number) => string;
	buildRows: (runs: Run[]) => Cell[][];
}

const FIVE_MINUTES = 5 * 60_000;

/** One square is always one run; the window shrinks as the schedule gets denser, so the grid stays around 300 squares. */
const LAYOUTS: Record<GridSchedule, GridLayout> = {
	every_5_min: {
		window: 'last 24 hours',
		columnLabels: Array.from({ length: 12 }, (_, slot) =>
			slot % 3 === 0 ? `:${String(slot * 5).padStart(2, '0')}` : '',
		),
		rowLabel: (start, rowIndex) =>
			rowIndex === 0 || start.getUTCHours() === 0 ? `${dayLabel(start)} ${hourLabel(start)}` : hourLabel(start),
		buildRows: (runs) => {
			const firstHour = Math.floor(NOW.getTime() / HOUR) * HOUR - 23 * HOUR;
			return Array.from({ length: 24 }, (_hour, hourIndex) =>
				Array.from({ length: 12 }, (_slot, slot) =>
					makeCell(new Date(firstHour + hourIndex * HOUR + slot * FIVE_MINUTES), FIVE_MINUTES, runs),
				),
			);
		},
	},
	hourly: {
		window: 'last 14 days',
		columnLabels: Array.from({ length: 24 }, (_, hour) => (hour % 6 === 0 ? String(hour) : '')),
		rowLabel: (start) => dayLabel(start),
		buildRows: (runs) => buildDayRows(runs),
	},
};

function hourLabel(date: Date) {
	return `${String(date.getUTCHours()).padStart(2, '0')}:00`;
}

interface LatestRunsStripProps {
	runs: Run[];
	nextRun: Date;
	selectedIndex?: number;
	onSelect?: (index: number) => void;
	tickLabel?: (index: number) => string | null;
	tall?: boolean;
}

function LatestRunsStrip({ runs, nextRun, selectedIndex, onSelect, tickLabel, tall = false }: LatestRunsStripProps) {
	const maxDuration = Math.max(...runs.map((run) => run.durationMs));
	return (
		<div className='flex flex-col gap-1'>
			<span className='text-[11px] text-muted-foreground'>
				{tall ? `${runs.length} runs` : `Last ${runs.length} runs`} · bar height is duration
			</span>
			<div className={cn('flex items-end gap-[2px]', tall ? 'h-24' : 'h-12')}>
				{runs.map((run, index) => (
					<button
						key={run.at.getTime()}
						type='button'
						disabled={!onSelect}
						onClick={() => onSelect?.(index)}
						title={`${formatShort(run.at)} · ${run.status}`}
						className='relative flex h-full flex-1 flex-col justify-end gap-[2px]'
					>
						<span
							className={cn(
								'w-full rounded-[2px]',
								BAR_CLASSES[run.status],
								run.status === 'missed' && 'h-full',
								index === selectedIndex &&
									'ring-2 ring-foreground ring-offset-1 ring-offset-background',
							)}
							style={
								run.status === 'missed'
									? undefined
									: { height: `${Math.max(8, (run.durationMs / maxDuration) * 100)}%` }
							}
						/>
						<span className='mx-auto flex h-1.5 items-start'>
							{run.trigger === 'manual' && <ManualMark />}
						</span>
						{tickLabel?.(index) && (
							<span className='absolute top-full left-0 mt-0.5 whitespace-nowrap text-[10px] text-muted-foreground tabular-nums'>
								{tickLabel(index)}
							</span>
						)}
					</button>
				))}
				<div className='flex h-full flex-1 flex-col justify-end gap-[2px]'>
					<span className='h-1/2 w-full rounded-[2px] border border-dashed border-primary' />
					<span className='mx-auto size-1' />
				</div>
			</div>
			<div
				className={cn(
					'flex justify-between text-[10px] text-muted-foreground tabular-nums',
					tickLabel && 'mt-4',
				)}
			>
				<span>{formatShort(runs[0].at)}</span>
				<span>
					last {formatShort(runs[runs.length - 1].at)} ·{' '}
					<span className='text-primary'>next {formatShort(nextRun)}</span>
				</span>
			</div>
		</div>
	);
}

function GridCell({ cell, isSelected, onSelect }: { cell: Cell; isSelected: boolean; onSelect: () => void }) {
	const status = summarize(cell);
	return (
		<button
			type='button'
			onClick={onSelect}
			title={describeCell(cell)}
			className={cn(
				'size-3.5 shrink-0 rounded-[3px] transition-transform hover:scale-125',
				CELL_CLASSES[status],
				isSelected && 'ring-2 ring-foreground ring-offset-1 ring-offset-background',
			)}
		/>
	);
}

function CellDetail({ cell, isDaily }: { cell?: Cell; isDaily: boolean }) {
	if (!cell) {
		return null;
	}
	const failed = cell.runs.filter((run) => run.status === 'failed');
	const missed = cell.runs.filter((run) => run.status === 'missed');
	const done = cell.runs.filter((run) => run.status === 'ok' || run.status === 'failed');
	const cost = cell.runs.reduce((sum, run) => sum + run.costUsd, 0);
	const median = done.map((run) => run.durationMs).sort((a, b) => a - b)[Math.floor(done.length / 2)];

	return (
		<div className='flex min-w-56 flex-1 flex-col gap-3 rounded-lg bg-muted/40 p-3 text-xs'>
			<div className='flex flex-col gap-0.5'>
				<span className='text-sm font-medium'>
					{isDaily ? formatDay(cell.start) : formatShort(cell.runs[0]?.at ?? cell.start)}
				</span>
				{cell.runs.length === 1 ? (
					<RunFacts run={cell.runs[0]} />
				) : (
					<span className='text-muted-foreground'>
						{cell.runs.length} run{cell.runs.length === 1 ? '' : 's'}
						{failed.length > 0 && <span className='text-destructive'> · {failed.length} failed</span>}
						{missed.length > 0 && <span> · {missed.length} missed</span>}
						{median !== undefined && <> · median {formatDuration(median)}</>} · {formatUsd(cost)}
					</span>
				)}
			</div>
			{cell.runs.length > 1 && (
				<div className='flex flex-wrap gap-[3px]'>
					{cell.runs.map((run) => (
						<span
							key={run.at.getTime()}
							title={`${formatShort(run.at)} · ${run.status}`}
							className={cn(
								'size-2.5 rounded-full',
								CELL_CLASSES[run.status === 'ok' ? 'ok' : run.status],
							)}
						/>
					))}
				</div>
			)}
			{failed[0]?.error && (
				<code className='rounded-md bg-destructive/10 px-2 py-1.5 whitespace-pre-wrap text-destructive'>
					{failed[0].error}
				</code>
			)}
		</div>
	);
}

function RunFacts({ run }: { run: Run }) {
	const tokens = Math.round(run.costUsd * 900_000);
	const facts = [
		run.trigger === 'manual' ? 'manual · Léa Martin' : 'scheduled',
		run.status === 'missed' ? 'did not start' : formatDuration(run.durationMs),
		'4 queries',
		tokens > 0 ? `${Math.round(tokens / 1000)}k tokens` : null,
		formatUsd(run.costUsd),
	].filter(Boolean);
	return (
		<span className='text-muted-foreground'>
			<span className={cn(run.status === 'failed' && 'text-destructive')}>{run.status}</span> ·{' '}
			{facts.join(' · ')}
		</span>
	);
}

function Legend({ aggregated }: { aggregated: boolean }) {
	const items: [CellStatus, string][] = aggregated
		? [
				['ok', 'all OK'],
				['partial', 'some failed'],
				['failed', 'all failed'],
				['missed', 'missed'],
			]
		: [
				['ok', 'OK'],
				['failed', 'failed'],
				['missed', 'missed'],
				['next', 'next'],
			];
	return (
		<div className='flex items-center gap-3 text-[11px] text-muted-foreground'>
			{items.map(([status, label]) => (
				<span key={status} className='flex items-center gap-1'>
					<span className={cn('size-2.5 rounded-[2px]', CELL_CLASSES[status])} />
					{label}
				</span>
			))}
			<span className='flex items-center gap-1'>
				<ManualMark />
				manual refresh
			</span>
		</div>
	);
}

type CellStatus = RunStatus | 'partial' | 'empty' | 'future' | 'next';

const CELL_CLASSES: Record<CellStatus, string> = {
	ok: 'bg-emerald-500 dark:bg-emerald-500/80',
	partial: 'bg-amber-400 dark:bg-amber-500/80',
	failed: 'bg-destructive',
	missed: 'border border-dashed border-muted-foreground/60 bg-transparent',
	running: 'bg-primary animate-pulse',
	empty: 'bg-muted',
	future: 'bg-muted/40',
	next: 'border border-dashed border-primary bg-primary/10',
};

const BAR_CLASSES: Record<RunStatus, string> = {
	ok: 'bg-emerald-500 dark:bg-emerald-500/80',
	failed: 'bg-destructive',
	missed: 'border border-dashed border-muted-foreground/60',
	running: 'bg-primary animate-pulse',
};

function summarize(cell: Cell): CellStatus {
	if (cell.isNext) {
		return 'next';
	}
	if (cell.isFuture) {
		return 'future';
	}
	if (cell.runs.length === 0) {
		return 'empty';
	}
	if (cell.runs.some((run) => run.status === 'running')) {
		return 'running';
	}
	const failed = cell.runs.filter((run) => run.status === 'failed').length;
	const missed = cell.runs.filter((run) => run.status === 'missed').length;
	if (missed === cell.runs.length) {
		return 'missed';
	}
	if (failed === 0) {
		return 'ok';
	}
	return failed === cell.runs.length ? 'failed' : 'partial';
}

function describeCell(cell: Cell): string {
	const failed = cell.runs.filter((run) => run.status === 'failed').length;
	return `${formatShort(cell.start)} · ${cell.runs.length} runs${failed ? ` · ${failed} failed` : ''}`;
}

function buildDayRows(runs: Run[]): Cell[][] {
	const firstDay = startOfUtcDay(new Date(NOW.getTime() - 13 * DAY));
	return Array.from({ length: 14 }, (_day, dayIndex) =>
		Array.from({ length: 24 }, (_hour, hour) => {
			const start = new Date(firstDay.getTime() + dayIndex * DAY + hour * HOUR);
			return makeCell(start, HOUR, runs);
		}),
	);
}

function markNextRun(rows: Cell[][], nextRun: Date): Cell[][] {
	const time = nextRun.getTime();
	return rows.map((row) =>
		row.map((cell) => (time >= cell.start.getTime() && time < cell.end ? { ...cell, isNext: true } : cell)),
	);
}

function makeCell(start: Date, length: number, runs: Run[]): Cell {
	const end = start.getTime() + length;
	return {
		key: start.toISOString(),
		start,
		end,
		runs: runs.filter((run) => run.at.getTime() >= start.getTime() && run.at.getTime() < end),
		isFuture: start.getTime() > NOW.getTime(),
	};
}

/** Deterministic fake history: a warehouse outage, a scheduler gap, a few flaky runs and some manual refreshes. */
function buildMockRuns(schedule: RefreshSchedule): Run[] {
	if (schedule === 'weekdays') {
		return buildWeekdayRuns();
	}
	const step =
		schedule === 'every_5_min'
			? 5 * 60_000
			: schedule === 'hourly'
				? HOUR
				: schedule === 'every_6_hours'
					? 6 * HOUR
					: DAY;
	const span = schedule === 'daily' ? 60 * DAY : 14 * DAY;
	const first =
		schedule === 'daily'
			? startOfUtcDay(new Date(NOW.getTime() - span)).getTime() + 7 * HOUR
			: startOfUtcDay(new Date(NOW.getTime() - 13 * DAY)).getTime();
	const isDense = schedule === 'every_5_min';
	const outageStart = Date.parse(
		isDense
			? '2026-11-26T22:10:00Z'
			: schedule === 'every_6_hours'
				? '2026-11-25T12:00:00Z'
				: '2026-11-25T14:00:00Z',
	);
	const outageEnd = schedule === 'daily' ? outageStart + DAY : outageStart + (isDense ? 40 * 60_000 : 1.25 * HOUR);
	const gapStart = Date.parse(
		isDense
			? '2026-11-27T03:00:00Z'
			: schedule === 'every_6_hours'
				? '2026-11-21T00:00:00Z'
				: '2026-11-21T02:00:00Z',
	);
	const gapEnd = gapStart + (isDense ? 20 * 60_000 : 2 * HOUR);
	const runs: Run[] = [];
	let seed = 7;
	const random = () => {
		seed = (seed * 16807) % 2147483647;
		return seed / 2147483647;
	};

	for (let time = first; time <= NOW.getTime(); time += step) {
		const at = new Date(time);
		const isOutage =
			schedule === 'daily' ? at.toISOString().startsWith('2026-11-25') : time >= outageStart && time < outageEnd;
		const isGap = schedule !== 'daily' && time >= gapStart && time < gapEnd;
		const isFlaky =
			random() <
			(schedule === 'daily' || schedule === 'every_6_hours' ? 0.03 : schedule === 'hourly' ? 0.008 : 0.006);
		const status: RunStatus = isGap ? 'missed' : isOutage || isFlaky ? 'failed' : 'ok';
		const durationMs =
			status === 'missed' ? 0 : (isOutage ? 31_000 : 14_000 + random() * 9_000) * (random() < 0.03 ? 2.4 : 1);
		runs.push({
			at,
			status,
			trigger: 'schedule',
			durationMs,
			costUsd: status === 'ok' ? 0.04 + random() * 0.01 : 0,
			error: isOutage
				? WAREHOUSE_ERROR
				: isFlaky
					? 'Live text rewrite timed out after 60s (model claude-sonnet-5-5).'
					: undefined,
		});
		if (!isDense && random() < 0.04) {
			runs.push({
				at: new Date(time + step / 2),
				status: 'ok',
				trigger: 'manual',
				durationMs: 19_000,
				costUsd: 0.047,
			});
		}
	}
	return runs;
}

function buildWeekdayRuns(): Run[] {
	const runs: Run[] = [];
	const firstDay = startOfUtcDay(new Date(NOW.getTime() - 27 * DAY)).getTime();
	let seed = 11;
	const random = () => {
		seed = (seed * 16807) % 2147483647;
		return seed / 2147483647;
	};
	for (let day = firstDay; day <= NOW.getTime(); day += DAY) {
		const weekday = new Date(day).getUTCDay();
		if (weekday === 0 || weekday === 6) {
			continue;
		}
		for (const hour of [9, 12, 17]) {
			const time = day + hour * HOUR;
			if (time > NOW.getTime()) {
				continue;
			}
			const at = new Date(time);
			const isOutage = at.toISOString().startsWith('2026-11-25T12');
			const isMissed = at.toISOString().startsWith('2026-11-16T09');
			const isFlaky = hour === 17 && random() < 0.25;
			const status: RunStatus = isMissed ? 'missed' : isOutage || isFlaky ? 'failed' : 'ok';
			runs.push({
				at,
				status,
				trigger: 'schedule',
				durationMs: status === 'missed' ? 0 : isOutage ? 31_000 : 14_000 + random() * 9_000,
				costUsd: status === 'ok' ? 0.04 + random() * 0.01 : 0,
				error: isOutage
					? WAREHOUSE_ERROR
					: isFlaky
						? 'Live text rewrite timed out after 60s (model claude-sonnet-5-5).'
						: undefined,
			});
			if (random() < 0.05) {
				runs.push({
					at: new Date(time + HOUR),
					status: 'ok',
					trigger: 'manual',
					durationMs: 19_000,
					costUsd: 0.047,
				});
			}
		}
	}
	return runs;
}

function startOfUtcDay(date: Date): Date {
	return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

const dayFormatter = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
const weekdayFormatter = new Intl.DateTimeFormat('en-US', { weekday: 'short', day: 'numeric', timeZone: 'UTC' });
const shortFormatter = new Intl.DateTimeFormat('en-US', {
	month: 'short',
	day: 'numeric',
	hour: '2-digit',
	minute: '2-digit',
	hourCycle: 'h23',
	timeZone: 'UTC',
});

function dayLabel(date: Date) {
	return weekdayFormatter.format(date);
}

function formatDay(date: Date) {
	return dayFormatter.format(date);
}

function formatShort(date: Date) {
	return shortFormatter.format(date);
}
