import { AlertTriangle, CircleCheck, CircleX, RefreshCw } from 'lucide-react';
import { useState } from 'react';
import type {
	LocalAgentRateLimits,
	LocalAgentRateLimitWindow,
	LocalAgentStatus,
	LocalAgentUsageSummary,
} from '@nao/shared/local-agent';
import type { MeterSeverity } from '@/lib/local-agent-format';

import { Button } from '@/components/ui/button';
import { SettingsCard } from '@/components/ui/settings-card';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useLocalAgentOverview } from '@/hooks/use-local-agent-overview';
import { useLocalAgentStatus } from '@/hooks/use-local-agent-status';
import { isDesktopApp } from '@/lib/local-agent';
import {
	formatCompactNumber,
	formatEstimatedCost,
	formatPlanName,
	formatResetTime,
	meterSeverity,
} from '@/lib/local-agent-format';
import { formatDuration, formatInteger } from '@/lib/monitoring-format';
import { cn } from '@/lib/utils';

const turnTimeFormatter = new Intl.DateTimeFormat('en-US', {
	month: 'short',
	day: 'numeric',
	hour: '2-digit',
	minute: '2-digit',
	hourCycle: 'h23',
});

/** The user's own Claude, run by the desktop app: who is signed in, the plan limits, and what nao used. */
export function ClaudeCodeConnectionSettings() {
	if (!isDesktopApp()) {
		return (
			<SettingsCard title='Claude Code connection' titleSize='lg'>
				<p className='text-sm text-muted-foreground'>
					Open nao in the desktop app to chat through the Claude Code installed on your computer and see its
					usage here.
				</p>
			</SettingsCard>
		);
	}
	return (
		<>
			<AccountCard />
			<PlanLimitsCard />
			<NaoUsageCard />
		</>
	);
}

function AccountCard() {
	const { status, isPending, refresh } = useLocalAgentStatus();
	const [isRefreshing, setIsRefreshing] = useState(false);

	const handleRefresh = async () => {
		setIsRefreshing(true);
		try {
			await refresh();
		} finally {
			setIsRefreshing(false);
		}
	};

	return (
		<SettingsCard
			title='Claude Code connection'
			titleSize='lg'
			description='Experimental. Chats run on the Claude Code signed in on this computer, with nao tools, under your own Claude plan and Anthropic’s terms. Your plan pays for them, not nao.'
			action={
				<Button variant='outline' size='sm' onClick={handleRefresh} disabled={isRefreshing}>
					<RefreshCw className={cn('size-3.5', isRefreshing && 'animate-spin')} />
					Refresh
				</Button>
			}
		>
			{isPending ? <Skeleton className='h-20 w-full' /> : <AccountDetails status={status} />}
		</SettingsCard>
	);
}

function AccountDetails({ status }: { status: LocalAgentStatus | undefined }) {
	if (status?.state !== 'ready') {
		return <StatusMessage status={status} />;
	}
	return (
		<dl className='grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm'>
			<dt className='text-muted-foreground'>Status</dt>
			<dd className='flex items-center gap-1.5 text-foreground'>
				<CircleCheck className='size-4 text-emerald-600 dark:text-emerald-400' aria-hidden />
				Signed in
			</dd>
			<dt className='text-muted-foreground'>Account</dt>
			<dd className='text-foreground'>{status.account.email ?? 'Not shared by Claude Code'}</dd>
			<dt className='text-muted-foreground'>Plan</dt>
			<dd className='text-foreground'>{formatPlanName(status.account.subscriptionType)}</dd>
			<dt className='text-muted-foreground'>Claude Code</dt>
			<dd className='font-mono text-foreground'>{status.version}</dd>
		</dl>
	);
}

function StatusMessage({ status }: { status: LocalAgentStatus | undefined }) {
	const { title, detail } = describeStatus(status);
	return (
		<div className='flex items-start gap-2 text-sm'>
			<CircleX className='size-4 mt-0.5 text-destructive shrink-0' aria-hidden />
			<div className='flex flex-col gap-0.5'>
				<span className='font-medium text-foreground'>{title}</span>
				<span className='text-muted-foreground'>{detail}</span>
			</div>
		</div>
	);
}

function PlanLimitsCard() {
	const overview = useLocalAgentOverview();
	return (
		<SettingsCard title='Plan limits' description='How much of your Claude plan is used, across every app on it.'>
			{overview.isPending ? (
				<Skeleton className='h-24 w-full' />
			) : overview.isError ? (
				<p className='text-sm text-muted-foreground'>
					Could not read the plan limits: {overview.error.message}
				</p>
			) : (
				<PlanLimits rateLimits={overview.data.rateLimits} />
			)}
		</SettingsCard>
	);
}

function PlanLimits({ rateLimits }: { rateLimits: LocalAgentRateLimits }) {
	if (rateLimits.state === 'unavailable') {
		return (
			<p className='text-sm text-muted-foreground'>
				Plan limits only apply when Claude Code is signed in to a Claude plan. This Claude Code uses an API key
				or a cloud provider.
			</p>
		);
	}
	if (rateLimits.state === 'error') {
		return <p className='text-sm text-muted-foreground'>Could not read the plan limits: {rateLimits.message}</p>;
	}
	return (
		<div className='flex flex-col gap-5'>
			{rateLimits.windows.map((window) => (
				<LimitMeter key={window.label} window={window} />
			))}
			{rateLimits.windows.length === 0 && (
				<p className='text-sm text-muted-foreground'>Claude did not report any limit for this plan.</p>
			)}
			{rateLimits.extraUsage && (
				<p className='text-xs text-muted-foreground'>
					Extra usage is on
					{rateLimits.extraUsage.usedCredits !== null &&
						`: ${formatInteger(rateLimits.extraUsage.usedCredits)} of ${
							rateLimits.extraUsage.monthlyLimit === null
								? 'no set limit'
								: formatInteger(rateLimits.extraUsage.monthlyLimit)
						} ${rateLimits.extraUsage.currency ?? ''} used this month`}
					.
				</p>
			)}
		</div>
	);
}

/** The fill carries the severity; the track is a lighter step of the same color. */
const METER_COLORS: Record<MeterSeverity, { track: string; fill: string }> = {
	normal: { track: 'bg-primary/15', fill: 'bg-primary' },
	warning: { track: 'bg-amber-500/20', fill: 'bg-amber-500' },
	critical: { track: 'bg-destructive/20', fill: 'bg-destructive' },
};

function LimitMeter({ window }: { window: LocalAgentRateLimitWindow }) {
	const severity = meterSeverity(window.utilization);
	const utilization = Math.min(100, Math.max(0, window.utilization ?? 0));
	const resetTime = formatResetTime(window.resetsAt);
	return (
		<div className='flex flex-col gap-1.5'>
			<div className='flex items-baseline justify-between gap-4 text-sm'>
				<span className='font-medium text-foreground'>{window.label}</span>
				<span className='flex items-center gap-1.5 text-foreground'>
					{severity !== 'normal' && (
						<span className='flex items-center gap-1 text-xs text-muted-foreground'>
							<AlertTriangle className='size-3.5' aria-hidden />
							{severity === 'critical' ? 'Almost at the limit' : 'Getting close'}
						</span>
					)}
					{window.utilization === null ? 'Not reported' : `${Math.round(utilization)}% used`}
				</span>
			</div>
			<div
				role='meter'
				aria-label={window.label}
				aria-valuemin={0}
				aria-valuemax={100}
				aria-valuenow={utilization}
				className={cn('h-2 w-full overflow-hidden rounded-full', METER_COLORS[severity].track)}
			>
				<div
					className={cn('h-full rounded-full', METER_COLORS[severity].fill)}
					style={{ width: `${utilization}%` }}
				/>
			</div>
			{resetTime && <span className='text-xs text-muted-foreground'>{resetTime}</span>}
		</div>
	);
}

function NaoUsageCard() {
	const overview = useLocalAgentOverview();
	return (
		<SettingsCard
			title='Used through nao'
			description='Turns run on this server from this computer, recorded locally: nao does not store them.'
		>
			{overview.isPending ? (
				<Skeleton className='h-40 w-full' />
			) : overview.isError ? (
				<p className='text-sm text-muted-foreground'>Could not read the usage: {overview.error.message}</p>
			) : (
				<NaoUsage usage={overview.data.usage} />
			)}
		</SettingsCard>
	);
}

function NaoUsage({ usage }: { usage: LocalAgentUsageSummary }) {
	if (usage.totals.turns === 0) {
		return (
			<p className='text-sm text-muted-foreground'>
				No chat ran through your Claude Code in the last {usage.periodDays} days. Pick a model under “Your
				Claude Code” in the chat to start.
			</p>
		);
	}
	return (
		<div className='flex flex-col gap-6'>
			<div className='grid grid-cols-2 gap-4 md:grid-cols-4'>
				<StatTile label={`Turns, last ${usage.periodDays} days`} value={formatInteger(usage.totals.turns)} />
				<StatTile label='Input tokens' value={formatCompactNumber(usage.totals.inputTokens)} />
				<StatTile label='Output tokens' value={formatCompactNumber(usage.totals.outputTokens)} />
				<StatTile label='API price estimate' value={formatEstimatedCost(usage.totals.estimatedCostUsd)} />
			</div>
			<p className='text-xs text-muted-foreground'>
				The price estimate is what these tokens would cost on the Anthropic API, as Claude Code computes it.
				Your plan does not bill it.
			</p>
			<UsageByModel usage={usage} />
			<RecentTurns usage={usage} />
		</div>
	);
}

function StatTile({ label, value }: { label: string; value: string }) {
	return (
		<div className='flex flex-col gap-1 rounded-lg border p-3'>
			<span className='text-xs text-muted-foreground'>{label}</span>
			<span className='text-xl font-semibold text-foreground'>{value}</span>
		</div>
	);
}

function UsageByModel({ usage }: { usage: LocalAgentUsageSummary }) {
	return (
		<Table>
			<TableHeader>
				<TableRow>
					<TableHead>Model</TableHead>
					<TableHead className='text-right'>Turns</TableHead>
					<TableHead className='text-right'>Input tokens</TableHead>
					<TableHead className='text-right'>Output tokens</TableHead>
					<TableHead className='text-right'>API price estimate</TableHead>
				</TableRow>
			</TableHeader>
			<TableBody className='tabular-nums'>
				{usage.byModel.map((model) => (
					<TableRow key={model.modelId}>
						<TableCell className='font-mono text-xs'>{model.modelId || 'Unknown'}</TableCell>
						<TableCell className='text-right'>{formatInteger(model.turns)}</TableCell>
						<TableCell className='text-right'>{formatInteger(model.inputTokens)}</TableCell>
						<TableCell className='text-right'>{formatInteger(model.outputTokens)}</TableCell>
						<TableCell className='text-right'>{formatEstimatedCost(model.estimatedCostUsd)}</TableCell>
					</TableRow>
				))}
			</TableBody>
		</Table>
	);
}

function RecentTurns({ usage }: { usage: LocalAgentUsageSummary }) {
	return (
		<div className='flex flex-col gap-2'>
			<span className='text-sm font-medium text-foreground'>Recent turns</span>
			<Table>
				<TableHeader>
					<TableRow>
						<TableHead>When</TableHead>
						<TableHead>Model</TableHead>
						<TableHead className='text-right'>Tokens in / out</TableHead>
						<TableHead className='text-right'>Duration</TableHead>
						<TableHead className='text-right'>Ended</TableHead>
					</TableRow>
				</TableHeader>
				<TableBody className='tabular-nums'>
					{usage.recentTurns.map((turn) => (
						<TableRow key={turn.at}>
							<TableCell>{turnTimeFormatter.format(new Date(turn.at))}</TableCell>
							<TableCell className='font-mono text-xs'>{turn.modelId || 'Unknown'}</TableCell>
							<TableCell className='text-right'>
								{formatInteger(turn.inputTokens)} / {formatInteger(turn.outputTokens)}
							</TableCell>
							<TableCell className='text-right'>{formatDuration(turn.durationMs)}</TableCell>
							<TableCell className='text-right'>{STOP_REASON_LABELS[turn.stopReason]}</TableCell>
						</TableRow>
					))}
				</TableBody>
			</Table>
		</div>
	);
}

const STOP_REASON_LABELS = { stop: 'Answered', error: 'Failed', interrupted: 'Stopped' } as const;

function describeStatus(status: LocalAgentStatus | undefined): { title: string; detail: string } {
	switch (status?.state) {
		case 'not-installed':
			return {
				title: 'Claude Code is not installed',
				detail: 'Install Claude Code on this computer, run `claude` in a terminal to sign in, then refresh.',
			};
		case 'not-logged-in':
			return {
				title: 'Claude Code is not signed in',
				detail: `Run \`claude\` in a terminal and sign in with your Claude account, then refresh. Version ${status.version}.`,
			};
		case 'error':
			return { title: 'Claude Code could not be checked', detail: status.message };
		default:
			return { title: 'Claude Code is not available', detail: 'Refresh to check again.' };
	}
}
