import { useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { ArrowUpRight } from 'lucide-react';
import type { inferRouterOutputs } from '@trpc/server';

import type { TrpcRouter } from '@nao/backend/trpc';

import { DEFAULT_USAGE_SEARCH } from '@/components/settings/usage-route-search';
import { Button } from '@/components/ui/button';
import { SettingsCard } from '@/components/ui/settings-card';
import { trpc } from '@/main';

type CreditLedgerCursor = { createdAt: Date; id: string };
type ManagedAiUsageCursor = { startedAt: Date; id: string };

export function CreditsWalletContent({ canViewReplay }: { canViewReplay: boolean }) {
	const summary = useQuery(trpc.account.getCreditSummary.queryOptions());
	const [ledgerCursor, setLedgerCursor] = useState<CreditLedgerCursor>();
	const [usageCursor, setUsageCursor] = useState<ManagedAiUsageCursor>();
	const ledger = useQuery({
		...trpc.account.listCreditLedger.queryOptions({ cursor: ledgerCursor, limit: 10 }),
		placeholderData: keepPreviousData,
		enabled: summary.data?.enabled === true,
	});
	const usage = useQuery({
		...trpc.account.listManagedAiUsage.queryOptions({ cursor: usageCursor, limit: 10 }),
		placeholderData: keepPreviousData,
	});

	return (
		<div className='flex flex-col gap-4'>
			{summary.data?.enabled && (
				<>
					<SettingsCard title='Organization wallet'>
						<p className='mb-3 text-sm text-muted-foreground'>
							Shared nao credits available across every project in this organization.
						</p>
						<div className='grid gap-3 sm:grid-cols-3'>
							<CreditMetric label='Available' value={summary.data.balanceMicroUsd} />
							<CreditMetric label='Credited' value={summary.data.lifetimeCreditedMicroUsd} />
							<CreditMetric label='Debited' value={summary.data.lifetimeDebitedMicroUsd} />
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
										const grantType = getGrantType(group);
										return (
											<tr key={group.id} className='border-t border-border'>
												<td className='py-2'>{formatDate(group.createdAt)}</td>
												<td className='py-2'>
													{ledgerLabel(
														entry.entryType,
														entry.deltaMicroUsd,
														grantType,
														group,
													)}
													{entry.entryType === 'gift' &&
														grantType !== 'organization_setup' && (
															<span className='ml-2 text-muted-foreground'>
																{' '}
																{group.grantedForUserName ?? 'Former user'}
															</span>
														)}
													{entry.entryType === 'usage' && (
														<span className='ml-2 text-muted-foreground'>
															{' '}
															{group.entries.length}{' '}
															{group.entries.length === 1 ? 'call' : 'calls'}
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
							hasNext={ledger.data?.nextCursor !== null && ledger.data?.nextCursor !== undefined}
							onPrevious={() => setLedgerCursor(undefined)}
							onNext={() => setLedgerCursor(ledger.data?.nextCursor ?? undefined)}
						/>
					</SettingsCard>
				</>
			)}

			<SettingsCard title='Managed AI charges'>
				<p className='mb-3 text-sm text-muted-foreground'>
					Organization-wide nao-managed model calls and the credits charged for them.
				</p>
				<div className='flex flex-col gap-2'>
					{usage.data?.runs.map((run) => (
						<UsageRun key={run.id} run={run} canViewReplay={canViewReplay} />
					))}
				</div>
				<PageControls
					hasPrevious={usageCursor !== undefined}
					hasNext={usage.data?.nextCursor !== null && usage.data?.nextCursor !== undefined}
					onPrevious={() => setUsageCursor(undefined)}
					onNext={() => setUsageCursor(usage.data?.nextCursor ?? undefined)}
				/>
			</SettingsCard>
		</div>
	);
}

type UsageRunData = inferRouterOutputs<TrpcRouter>['account']['listManagedAiUsage']['runs'][number];
type CreditLedgerGroup = inferRouterOutputs<TrpcRouter>['account']['listCreditLedger']['groups'][number];

function summarizeLedgerGroup(group: CreditLedgerGroup) {
	const [firstEntry, ...remainingEntries] = group.entries;
	if (!firstEntry) {
		throw new Error('Credit ledger group cannot be empty.');
	}
	const latestEntry = remainingEntries.reduce(
		(latest, entry) => (entry.transactionSequence > latest.transactionSequence ? entry : latest),
		firstEntry,
	);
	return {
		entryType: latestEntry.entryType,
		deltaMicroUsd: group.entries.reduce((total, entry) => total + entry.deltaMicroUsd, 0),
		balanceAfterMicroUsd: latestEntry.balanceAfterMicroUsd,
	};
}

function UsageRun({ run, canViewReplay }: { run: UsageRunData; canViewReplay: boolean }) {
	const summary = summarizeRun(run);
	return (
		<details className='rounded-md border border-border'>
			<summary className='grid cursor-pointer list-none gap-2 p-3 text-sm sm:grid-cols-[minmax(0,1fr)_auto_auto_auto] sm:items-center'>
				<div className='min-w-0'>
					<div className='flex min-w-0 items-center gap-2'>
						<div className='truncate font-medium'>{summary.title}</div>
						{summary.chatId && canViewReplay && (
							<Button asChild variant='ghost-muted' size='icon-xs'>
								<Link
									to='/settings/usage/replay/$chatId'
									params={{ chatId: summary.chatId }}
									search={{ ...DEFAULT_USAGE_SEARCH, tab: 'usage' }}
									onClick={(event) => event.stopPropagation()}
									aria-label='Open chat replay'
									title='Open chat replay'
								>
									<ArrowUpRight />
								</Link>
							</Button>
						)}
					</div>
					<div className='text-xs text-muted-foreground'>
						{run.userName ?? 'Former user'} · {formatDate(run.startedAt)} · {summary.models}
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
								<th className='py-2 text-right font-medium'>Upstream cost</th>
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
		status: summarizeRunStatus(events),
		estimated: events.some((event) => event.costSource === 'estimated'),
		chatId: events.find((event) => event.chatId)?.chatId,
	};
}

function summarizeRunStatus(events: UsageRunData['events']): string {
	if (events.length > 0 && events.every((event) => event.status === 'failed')) {
		return 'Failed';
	}
	if (events.length > 0 && events.every((event) => event.status === 'aborted')) {
		return 'Aborted';
	}
	if (events.some((event) => event.status === 'failed')) {
		return 'Partially failed';
	}
	if (events.some((event) => event.status === 'aborted')) {
		return 'Partially aborted';
	}
	return 'Completed';
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

function ledgerLabel(
	entryType: string,
	deltaMicroUsd: number,
	grantType: string | null,
	group: CreditLedgerGroup,
): string {
	return entryType === 'gift'
		? `${formatGiftUsd(deltaMicroUsd)} ${
				grantType === 'organization_setup'
					? 'project setup grant'
					: grantType === 'user_join'
						? 'member join grant'
						: 'nao gift'
			}`
		: entryType === 'usage'
			? `nao AI - ${group.usageUserName ?? 'Former user'}`
			: entryType;
}

function getGrantType(group: CreditLedgerGroup): string | null {
	const grantType = group.entries.find((entry) => entry.metadata?.grantType)?.metadata?.grantType;
	return typeof grantType === 'string' ? grantType : null;
}

function formatGiftUsd(microUsd: number): string {
	return new Intl.NumberFormat(undefined, {
		style: 'currency',
		currency: 'USD',
		minimumFractionDigits: 0,
		maximumFractionDigits: 2,
	}).format(microUsd / 1_000_000);
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
