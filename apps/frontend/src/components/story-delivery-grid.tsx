import { Mail, MessageSquare, RefreshCw } from 'lucide-react';
import { useState } from 'react';
import type { LucideIcon } from 'lucide-react';

import { cn } from '@/lib/utils';

type StepStatus = 'ok' | 'partial' | 'failed' | 'skipped';

interface DeliveryStep {
	status: StepStatus;
	detail: string;
	error?: string;
}

interface DeliveryRun {
	sentAt: Date;
	recipients: number;
	reached: number;
	steps: Record<StepId, DeliveryStep>;
}

type StepId = 'refresh' | 'email' | 'slack';

const STEPS: { id: StepId; label: string; Icon: LucideIcon }[] = [
	{ id: 'refresh', label: 'Refresh', Icon: RefreshCw },
	{ id: 'email', label: 'Email', Icon: Mail },
	{ id: 'slack', label: '#sales-weekly', Icon: MessageSquare },
];

const STATUS_CLASSES: Record<StepStatus, string> = {
	ok: 'bg-emerald-500 dark:bg-emerald-500/80',
	partial: 'bg-amber-400 dark:bg-amber-500/80',
	failed: 'bg-destructive',
	skipped: 'bg-muted-foreground/20',
};

const STATUS_LABELS: Record<StepStatus, string> = {
	ok: 'sent',
	partial: 'partly sent',
	failed: 'failed',
	skipped: 'not sent',
};

const RUNS = buildMockDeliveries();
const NEXT_SEND = new Date('2026-12-04T08:00:00Z');
const NEXT_CLASSES = 'border border-dashed border-primary bg-primary/10';

/** Airflow-like grid for deliveries: one column per send, one row per step (the refresh before it, then each channel). */
export function StoryDeliveryGrid() {
	const latestProblem = [...RUNS].reverse().find((run) => overallStatus(run) !== 'ok');
	const [selectedIndex, setSelectedIndex] = useState(latestProblem ? RUNS.indexOf(latestProblem) : RUNS.length - 1);
	const selected = RUNS[selectedIndex];
	const maxRecipients = Math.max(...RUNS.map((run) => run.recipients));

	return (
		<section className='flex flex-col gap-4 rounded-xl border p-4'>
			<header className='flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2'>
				<h3 className='text-sm font-semibold'>
					Delivery history
					<span className='ml-2 text-xs font-normal text-muted-foreground'>
						every Friday at 8:00 · email + Slack · 14 recipients · last {RUNS.length} sends
					</span>
				</h3>
				<div className='flex items-center gap-3 text-[11px] text-muted-foreground'>
					{(Object.keys(STATUS_LABELS) as StepStatus[]).map((status) => (
						<span key={status} className='flex items-center gap-1'>
							<span className={cn('size-2.5 rounded-[2px]', STATUS_CLASSES[status])} />
							{STATUS_LABELS[status]}
						</span>
					))}
					<span className='flex items-center gap-1'>
						<span className={cn('size-2.5 rounded-[2px]', NEXT_CLASSES)} />
						next
					</span>
				</div>
			</header>

			<div className='grid grid-cols-[7.5rem_1fr] gap-x-3 gap-y-[3px]'>
				<span className='self-end pb-1 text-[11px] text-muted-foreground'>Recipients reached</span>
				<Columns>
					{RUNS.map((run, index) => (
						<button
							key={index}
							type='button'
							onClick={() => setSelectedIndex(index)}
							title={`${run.reached} of ${run.recipients} reached`}
							className='flex h-12 items-end'
						>
							<span
								className={cn(
									'w-full rounded-[3px]',
									STATUS_CLASSES[overallStatus(run)],
									run.reached === 0 && 'h-1',
								)}
								style={
									run.reached > 0 ? { height: `${(run.reached / maxRecipients) * 100}%` } : undefined
								}
							/>
						</button>
					))}
					<span className='flex h-12 items-end'>
						<span className={cn('h-1/3 w-full rounded-[3px]', NEXT_CLASSES)} />
					</span>
				</Columns>

				{STEPS.map(({ id, label, Icon }) => (
					<StepRow key={id} label={label} Icon={Icon}>
						{RUNS.map((run, index) => (
							<button
								key={index}
								type='button'
								onClick={() => setSelectedIndex(index)}
								title={`${label} · ${STATUS_LABELS[run.steps[id].status]}`}
								className={cn(
									'h-5 rounded-[3px] transition-transform hover:scale-110',
									STATUS_CLASSES[run.steps[id].status],
									index === selectedIndex &&
										'ring-2 ring-foreground ring-offset-1 ring-offset-background',
								)}
							/>
						))}
						<span className={cn('h-5 rounded-[3px]', NEXT_CLASSES)} title={`${label} · next send`} />
					</StepRow>
				))}

				<span />
				<Columns>
					{RUNS.map((run, index) => (
						<span
							key={index}
							className={cn(
								'pt-1 text-center text-[10px] tabular-nums text-muted-foreground',
								index === selectedIndex && 'font-medium text-foreground',
							)}
						>
							{index % 2 === RUNS.length % 2 || index === selectedIndex ? shortDate(run.sentAt) : ''}
						</span>
					))}
					<span className='pt-1 text-center text-[10px] font-medium text-primary tabular-nums'>
						{shortDate(NEXT_SEND)}
					</span>
				</Columns>
			</div>

			<DeliveryDetail run={selected} />
		</section>
	);
}

function StepRow({ label, Icon, children }: { label: string; Icon: LucideIcon; children: React.ReactNode }) {
	return (
		<>
			<span className='flex items-center gap-1.5 truncate text-xs text-muted-foreground'>
				<Icon className='size-3 shrink-0' />
				<span className='truncate'>{label}</span>
			</span>
			<Columns>{children}</Columns>
		</>
	);
}

function Columns({ children }: { children: React.ReactNode }) {
	return <div className='grid grid-flow-col auto-cols-fr gap-[3px]'>{children}</div>;
}

function DeliveryDetail({ run }: { run: DeliveryRun }) {
	const status = overallStatus(run);
	return (
		<div className='flex flex-col gap-2 rounded-lg bg-muted/40 p-3 text-xs'>
			<div className='flex items-baseline justify-between gap-2'>
				<span className='text-sm font-medium'>{longDate(run.sentAt)}</span>
				<span
					className={cn(status === 'failed' && 'text-destructive', status === 'partial' && 'text-amber-600')}
				>
					{STATUS_LABELS[status]} · {run.reached} of {run.recipients} reached
				</span>
			</div>
			<ul className='flex flex-col gap-1.5'>
				{STEPS.map(({ id, label, Icon }) => {
					const step = run.steps[id];
					return (
						<li key={id} className='flex flex-col gap-1'>
							<span className='flex items-center gap-2'>
								<span className={cn('size-2.5 shrink-0 rounded-[2px]', STATUS_CLASSES[step.status])} />
								<Icon className='size-3 text-muted-foreground' />
								<span className='font-medium'>{label}</span>
								<span className='text-muted-foreground'>{step.detail}</span>
							</span>
							{step.error && (
								<code className='ml-[18px] rounded-md bg-destructive/10 px-2 py-1 whitespace-pre-wrap text-destructive'>
									{step.error}
								</code>
							)}
						</li>
					);
				})}
			</ul>
		</div>
	);
}

function overallStatus(run: DeliveryRun): StepStatus {
	const statuses = Object.values(run.steps).map((step) => step.status);
	if (run.reached === 0) {
		return 'failed';
	}
	return statuses.every((status) => status === 'ok') ? 'ok' : 'partial';
}

function buildMockDeliveries(): DeliveryRun[] {
	const last = Date.parse('2026-11-27T08:00:00Z');
	return Array.from({ length: 12 }, (_, index) => {
		const weeksAgo = 11 - index;
		const sentAt = new Date(last - weeksAgo * 7 * 86_400_000);
		const recipients = weeksAgo > 6 ? 12 : weeksAgo > 1 ? 13 : 14;
		const emailCount = recipients - 2;
		const ok = (detail: string): DeliveryStep => ({ status: 'ok', detail });
		const steps: Record<StepId, DeliveryStep> = {
			refresh: ok('4 queries · 19s'),
			email: ok(`${emailCount} of ${emailCount} sent`),
			slack: ok('posted'),
		};
		if (weeksAgo === 3) {
			steps.refresh = {
				status: 'failed',
				detail: 'failed after 31s',
				error: 'Snowflake warehouse COMPUTE_WH is suspended (code 000606).',
			};
			steps.email = { status: 'skipped', detail: 'not sent, the refresh failed' };
			steps.slack = { status: 'skipped', detail: 'not sent, the refresh failed' };
		}
		if (weeksAgo === 8) {
			steps.email = {
				status: 'partial',
				detail: `${emailCount - 1} of ${emailCount} sent`,
				error: 'marc.dupont@acme.com bounced: mailbox does not exist.',
			};
		}
		if (weeksAgo === 0) {
			steps.slack = {
				status: 'failed',
				detail: 'not posted',
				error: 'channel_not_found — nao was removed from #sales-weekly.',
			};
		}
		const reached =
			steps.refresh.status === 'failed'
				? 0
				: (steps.email.status === 'partial' ? emailCount - 1 : emailCount) +
					(steps.slack.status === 'ok' ? 2 : 0);
		return { sentAt, recipients, reached, steps };
	});
}

const shortFormatter = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
const longFormatter = new Intl.DateTimeFormat('en-US', {
	weekday: 'short',
	month: 'short',
	day: 'numeric',
	hour: '2-digit',
	minute: '2-digit',
	hourCycle: 'h23',
	timeZone: 'UTC',
});

function shortDate(date: Date) {
	return shortFormatter.format(date);
}

function longDate(date: Date) {
	return longFormatter.format(date);
}
