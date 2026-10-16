import { useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { ArrowUpRight } from 'lucide-react';
import { calculateCreditTopUp, CREDIT_TOP_UP_MAX_CENTS, CREDIT_TOP_UP_MIN_CENTS } from '@nao/shared/billing';
import type { inferRouterOutputs } from '@trpc/server';

import type { TrpcRouter } from '@nao/backend/trpc';

import { DEFAULT_USAGE_SEARCH } from '@/components/settings/usage-route-search';
import { Button } from '@/components/ui/button';
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { SettingsCard } from '@/components/ui/settings-card';
import { useCreditTopUp } from '@/hooks/use-credit-top-up';
import { trpc } from '@/main';

type CreditLedgerCursor = { createdAt: Date; id: string };
type ManagedAiUsageCursor = { startedAt: Date; id: string };

export function OrganizationCreditsContent({ creditCheckout }: { creditCheckout?: string }) {
	const summary = useQuery(trpc.account.getCreditSummary.queryOptions());
	const topUp = useCreditTopUp(creditCheckout);
	const [topUpAmount, setTopUpAmount] = useState('20');
	const [ledgerCursor, setLedgerCursor] = useState<CreditLedgerCursor>();
	const topUpAmountCents = parseUsdCents(topUpAmount);
	const topUpBreakdown = topUpAmountCents === null ? null : calculateCreditTopUp(topUpAmountCents);
	const ledger = useQuery({
		...trpc.account.listCreditLedger.queryOptions({ cursor: ledgerCursor, limit: 10 }),
		placeholderData: keepPreviousData,
		enabled: summary.data?.enabled === true,
	});

	return (
		<div className='flex flex-col gap-4'>
			{summary.data?.enabled && (
				<>
					<SettingsCard title='Balance'>
						<div className='mb-3 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between'>
							<p className='text-sm text-muted-foreground'>
								Shared nao credits available across every project in this organization.
							</p>
							<CreditTopUpDialog
								topUp={topUp}
								topUpAmount={topUpAmount}
								topUpBreakdown={topUpBreakdown}
								onTopUpAmountChange={setTopUpAmount}
							/>
						</div>
						{topUp.feedback && (
							<div className='mb-3 flex items-center justify-between gap-3'>
								<p className='text-sm'>{topUp.feedback}</p>
								{topUp.showRetry && (
									<Button variant='outline' size='sm' onClick={topUp.retryConfirmation}>
										Check again
									</Button>
								)}
							</div>
						)}
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
						<div className='mt-1 flex justify-end'>
							<Link
								to='/settings/usage'
								search={{ ...DEFAULT_USAGE_SEARCH, tab: 'managed-ai' }}
								className='inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground'
							>
								More details
								<ArrowUpRight aria-hidden='true' className='size-3.5' />
							</Link>
						</div>
					</SettingsCard>
				</>
			)}
		</div>
	);
}

export function ManagedAiChargesContent({
	canViewReplay,
	organizationWide = false,
}: {
	canViewReplay: boolean;
	organizationWide?: boolean;
}) {
	const [usageCursor, setUsageCursor] = useState<ManagedAiUsageCursor>();
	const usage = useQuery({
		...trpc.account.listManagedAiUsage.queryOptions({ cursor: usageCursor, limit: 10 }),
		placeholderData: keepPreviousData,
	});

	return (
		<div className='flex flex-col gap-4'>
			<SettingsCard title='nao AI usage'>
				<p className='mb-3 text-sm text-muted-foreground'>
					{organizationWide
						? 'Organization-wide model calls paid with nao credits.'
						: 'Your model calls paid with nao credits.'}
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

function CreditTopUpDialog({
	topUp,
	topUpAmount,
	topUpBreakdown,
	onTopUpAmountChange,
}: {
	topUp: ReturnType<typeof useCreditTopUp>;
	topUpAmount: string;
	topUpBreakdown: ReturnType<typeof calculateCreditTopUp> | null;
	onTopUpAmountChange: (value: string) => void;
}) {
	return (
		<Dialog>
			<DialogTrigger asChild>
				<Button size='sm'>Add credits</Button>
			</DialogTrigger>
			<DialogContent className='sm:max-w-2xl'>
				<DialogHeader>
					<DialogTitle>Add nao credits</DialogTitle>
					<DialogDescription>
						Credits are sold in US dollars and shared across every project in the organization.
					</DialogDescription>
				</DialogHeader>

				<div className='grid gap-5 sm:grid-cols-[minmax(0,1fr)_minmax(260px,0.8fr)]'>
					<div className='space-y-2'>
						<label className='block text-sm font-medium' htmlFor='credit-top-up-amount'>
							Credit amount
						</label>
						<div className='flex items-center gap-2'>
							<Input
								id='credit-top-up-amount'
								type='text'
								inputMode='decimal'
								value={topUpAmount}
								onChange={(event) => onTopUpAmountChange(event.target.value)}
							/>
							<span className='text-sm text-muted-foreground'>USD</span>
						</div>
						<p className='text-xs text-muted-foreground'>Choose an amount from $20 to $500.</p>
					</div>

					<div className='rounded-md border border-border bg-muted/30 p-4'>
						<p className='mb-3 text-sm font-medium'>Purchase summary</p>
						{topUpBreakdown ? (
							<div className='space-y-2 text-sm'>
								<div className='flex justify-between gap-4'>
									<span className='text-muted-foreground'>Credits added</span>
									<span>{formatUsdCents(topUpBreakdown.creditAmountCents)}</span>
								</div>
								<div className='flex justify-between gap-4'>
									<span className='text-muted-foreground'>nao platform fee (5%)</span>
									<span>{formatUsdCents(topUpBreakdown.platformFeeCents)}</span>
								</div>
								<div className='flex justify-between gap-4 border-t border-border pt-2 font-medium'>
									<span>Subtotal</span>
									<span>{formatUsdCents(topUpBreakdown.totalAmountCents)}</span>
								</div>
							</div>
						) : (
							<p className='text-sm text-destructive'>Enter an amount from $20 to $500.</p>
						)}
						<p className='mt-3 text-xs text-muted-foreground'>
							Applicable tax is calculated by Stripe. Your card issuer may convert this USD payment and
							charge conversion fees.
						</p>
					</div>
				</div>

				{topUp.error && <p className='text-sm text-destructive'>{topUp.error}</p>}
				<DialogFooter>
					<Button
						disabled={!topUpBreakdown || topUp.isPending}
						onClick={() => topUpBreakdown && topUp.startCheckout(topUpBreakdown.creditAmountCents)}
					>
						{topUp.isPending ? 'Opening Checkout…' : 'Continue to Stripe'}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
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
			: entryType === 'purchase'
				? 'Credit purchase'
				: entryType === 'refund'
					? 'Credit refund'
					: getAdjustmentType(group) === 'dispute_opened'
						? 'Credit purchase disputed'
						: getAdjustmentType(group) === 'dispute_won'
							? 'Dispute reversed'
							: getAdjustmentType(group) === 'reservation_release'
								? 'Expired credit reservation released'
								: entryType;
}

function getGrantType(group: CreditLedgerGroup): string | null {
	const grantType = group.entries.find((entry) => entry.metadata?.grantType)?.metadata?.grantType;
	return typeof grantType === 'string' ? grantType : null;
}

function getAdjustmentType(group: CreditLedgerGroup): string | null {
	const adjustmentType = group.entries.find((entry) => entry.metadata?.adjustmentType)?.metadata?.adjustmentType;
	return typeof adjustmentType === 'string' ? adjustmentType : null;
}

function parseUsdCents(value: string): number | null {
	if (!/^\d+(?:\.\d{1,2})?$/.test(value)) {
		return null;
	}
	const cents = Math.round(Number(value) * 100);
	return cents >= CREDIT_TOP_UP_MIN_CENTS && cents <= CREDIT_TOP_UP_MAX_CENTS ? cents : null;
}

function formatUsdCents(cents: number): string {
	return new Intl.NumberFormat(undefined, {
		style: 'currency',
		currency: 'USD',
		minimumFractionDigits: 2,
	}).format(cents / 100);
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
