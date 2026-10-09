import { useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import type { inferRouterOutputs } from '@trpc/server';

import type { TrpcRouter } from '@nao/backend/trpc';

import { Button } from '@/components/ui/button';
import { SettingsCard } from '@/components/ui/settings-card';
import { trpc } from '@/main';

type Cursor = { createdAt: Date; id: string };

export function CreditsAiUsage() {
	const summary = useQuery(trpc.account.getCreditSummary.queryOptions());
	const [ledgerCursor, setLedgerCursor] = useState<Cursor>();
	const [usageCursor, setUsageCursor] = useState<Cursor>();
	const ledger = useQuery({
		...trpc.account.listCreditLedger.queryOptions({ cursor: ledgerCursor, limit: 10 }),
		placeholderData: keepPreviousData,
		enabled: summary.data?.enabled === true,
	});
	const usage = useQuery({
		...trpc.account.listAiUsage.queryOptions({ cursor: usageCursor, limit: 10 }),
		placeholderData: keepPreviousData,
	});

	return (
		<div className='flex flex-col gap-4'>
			{summary.data?.enabled && (
				<>
					<SettingsCard title='Wallet'>
						<div className='grid gap-3 sm:grid-cols-3'>
							<CreditMetric label='Available' value={summary.data.balanceMicroUsd} />
							<CreditMetric label='Granted' value={summary.data.lifetimeGrantedMicroUsd} />
							<CreditMetric label='Used' value={summary.data.lifetimeSpentMicroUsd} />
						</div>
					</SettingsCard>

					<SettingsCard title='Credit history'>
						<div className='overflow-x-auto'>
							<table className='w-full text-sm'>
								<thead className='text-left text-muted-foreground'>
									<tr>
										<th className='py-2 font-medium'>Date</th>
										<th className='py-2 font-medium'>Description</th>
										<th className='py-2 text-right font-medium'>Change</th>
										<th className='py-2 text-right font-medium'>Balance</th>
									</tr>
								</thead>
								<tbody>
									{ledger.data?.groups.map((group) => {
										const entry = summarizeLedgerGroup(group);
										return (
											<tr key={group.id} className='border-t border-border'>
												<td className='py-2'>{formatDate(group.createdAt)}</td>
												<td className='py-2'>
													{ledgerLabel(entry.entryType)}
													{group.entries.length > 1 && (
														<span className='text-muted-foreground'>
															{' '}
															· {group.entries.length} calls
														</span>
													)}
												</td>
												<td className='py-2 text-right font-mono'>
													{formatSignedUsd(entry.deltaMicroUsd)}
												</td>
												<td className='py-2 text-right font-mono'>
													{formatUsd(entry.balanceAfterMicroUsd)}
												</td>
											</tr>
										);
									})}
								</tbody>
							</table>
						</div>
						<PageControls
							hasPrevious={ledgerCursor !== undefined}
							hasNext={ledger.data?.nextCursor !== null}
							onPrevious={() => setLedgerCursor(undefined)}
							onNext={() => setLedgerCursor(ledger.data?.nextCursor ?? undefined)}
						/>
					</SettingsCard>
				</>
			)}

			<SettingsCard title='Chat usage'>
				<div className='flex flex-col gap-2'>
					{usage.data?.runs.map((run) => (
						<UsageRun key={run.id} run={run} />
					))}
				</div>
				<PageControls
					hasPrevious={usageCursor !== undefined}
					hasNext={usage.data?.nextCursor !== null}
					onPrevious={() => setUsageCursor(undefined)}
					onNext={() => setUsageCursor(usage.data?.nextCursor ?? undefined)}
				/>
			</SettingsCard>
		</div>
	);
}

type UsageRunData = inferRouterOutputs<TrpcRouter>['account']['listAiUsage']['runs'][number];
type CreditLedgerGroup = inferRouterOutputs<TrpcRouter>['account']['listCreditLedger']['groups'][number];

function summarizeLedgerGroup(group: CreditLedgerGroup) {
	const latestEntry = group.entries.at(-1);
	if (!latestEntry) {
		throw new Error('Credit ledger group cannot be empty.');
	}
	return {
		entryType: latestEntry.entryType,
		deltaMicroUsd: group.entries.reduce((total, entry) => total + entry.deltaMicroUsd, 0),
		balanceAfterMicroUsd: latestEntry.balanceAfterMicroUsd,
	};
}

function UsageRun({ run }: { run: UsageRunData }) {
	const summary = summarizeRun(run);
	return (
		<details className='rounded-md border border-border'>
			<summary className='grid cursor-pointer list-none gap-2 p-3 text-sm sm:grid-cols-[minmax(0,1fr)_auto_auto_auto] sm:items-center'>
				<div className='min-w-0'>
					<div className='flex min-w-0 items-center gap-2'>
						<div className='truncate font-medium'>{summary.title}</div>
						{summary.chatId && (
							<Button
								asChild
								variant='outline'
								size='sm'
								className='h-5 max-w-48 px-1.5 font-mono text-[10px]'
							>
								<Link
									to='/$chatId'
									params={{ chatId: summary.chatId }}
									onClick={(event) => event.stopPropagation()}
									title={summary.chatId}
								>
									<span className='truncate'>{summary.chatId}</span>
								</Link>
							</Button>
						)}
					</div>
					<div className='text-xs text-muted-foreground'>
						{formatDate(run.startedAt)} · {summary.models}
					</div>
				</div>
				<div className='text-muted-foreground'>
					{run.events.length} {run.events.length === 1 ? 'call' : 'calls'}
				</div>
				<div className='font-mono'>{formatTokens(summary.totalTokens)} tokens</div>
				<div className='text-right font-mono'>
					{summary.charge > 0 ? formatUsd(summary.charge) : summary.cost}
				</div>
			</summary>
			<div className='border-t border-border p-3'>
				<div className='mb-3 text-xs text-muted-foreground'>
					<span>
						{summary.status}
						{summary.estimated ? ' · includes estimated usage' : ''}
					</span>
				</div>
				<div className='overflow-x-auto'>
					<table className='w-full text-sm'>
						<thead className='text-left text-muted-foreground'>
							<tr>
								<th className='py-2 font-medium'>Model</th>
								<th className='py-2 font-medium'>Type</th>
								<th className='py-2 text-right font-medium'>Input</th>
								<th className='py-2 text-right font-medium'>Cache read</th>
								<th className='py-2 text-right font-medium'>Cache write</th>
								<th className='py-2 text-right font-medium'>Output</th>
								<th className='py-2 text-right font-medium'>Reasoning</th>
								<th className='py-2 text-right font-medium'>Cost</th>
							</tr>
						</thead>
						<tbody>
							{run.events.map((event) => (
								<tr key={event.id} className='border-t border-border'>
									<td className='py-2'>
										<div>{event.llmModelId}</div>
										<div className='text-xs text-muted-foreground'>{event.llmProvider}</div>
									</td>
									<td className='py-2'>
										<div>{event.category}</div>
										<div className='text-xs text-muted-foreground'>
											{event.status}
											{event.costSource === 'estimated' ? ' · estimated' : ''}
										</div>
									</td>
									<td className='py-2 text-right font-mono'>{event.inputNoCacheTokens}</td>
									<td className='py-2 text-right font-mono'>{event.inputCacheReadTokens}</td>
									<td className='py-2 text-right font-mono'>{event.inputCacheWriteTokens}</td>
									<td className='py-2 text-right font-mono'>{event.outputTotalTokens}</td>
									<td className='py-2 text-right font-mono'>{event.outputReasoningTokens}</td>
									<td className='py-2 text-right font-mono'>
										{event.upstreamCostMicroUsd === null
											? 'Unknown'
											: formatUsd(event.upstreamCostMicroUsd)}
									</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
			</div>
		</details>
	);
}

function summarizeRun(run: UsageRunData) {
	const events = run.events;
	const categories = [...new Set(events.map((event) => event.category))].join(', ');
	const models = [...new Set(events.map((event) => event.llmModelId))].join(', ');
	const knownCosts = events.flatMap((event) =>
		event.upstreamCostMicroUsd === null ? [] : [event.upstreamCostMicroUsd],
	);
	const knownCost = knownCosts.reduce((total, cost) => total + cost, 0);
	return {
		title: run.chatTitle ?? categories,
		models,
		totalTokens: events.reduce((total, event) => total + (event.totalTokens ?? 0), 0),
		cost:
			knownCosts.length === events.length
				? formatUsd(knownCost)
				: knownCosts.length > 0
					? `${formatUsd(knownCost)}+`
					: 'Unknown',
		charge: events.reduce((total, event) => total + event.customerChargeMicroUsd, 0),
		status: events.some((event) => event.status === 'failed')
			? 'Partially failed'
			: events.some((event) => event.status === 'aborted')
				? 'Partially aborted'
				: 'Completed',
		estimated: events.some((event) => event.costSource === 'estimated'),
		chatId: events.find((event) => event.chatId)?.chatId,
	};
}

function CreditMetric({ label, value }: { label: string; value: number }) {
	return (
		<div className='rounded-md border border-border p-3'>
			<div className='text-xs text-muted-foreground'>{label}</div>
			<div className='text-lg font-semibold'>{formatUsd(value)}</div>
		</div>
	);
}

function PageControls({
	hasPrevious,
	hasNext,
	onPrevious,
	onNext,
}: {
	hasPrevious: boolean;
	hasNext: boolean;
	onPrevious: () => void;
	onNext: () => void;
}) {
	if (!hasPrevious && !hasNext) {
		return null;
	}
	return (
		<div className='mt-3 flex justify-end gap-2'>
			<Button variant='outline' size='sm' disabled={!hasPrevious} onClick={onPrevious}>
				Latest
			</Button>
			<Button variant='outline' size='sm' disabled={!hasNext} onClick={onNext}>
				Older
			</Button>
		</div>
	);
}

function ledgerLabel(entryType: string): string {
	return entryType === 'gift' ? 'Gift from nao' : entryType === 'usage' ? 'AI usage' : entryType;
}

function formatUsd(microUsd: number): string {
	return new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD', minimumFractionDigits: 2 }).format(
		microUsd / 1_000_000,
	);
}

function formatSignedUsd(microUsd: number): string {
	return `${microUsd > 0 ? '+' : ''}${formatUsd(microUsd)}`;
}

function formatTokens(tokens: number): string {
	return new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 }).format(tokens);
}

function formatDate(value: Date): string {
	return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(value);
}
