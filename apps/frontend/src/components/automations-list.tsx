import { Link } from '@tanstack/react-router';
import { Timer } from 'lucide-react';

import type { AutomationEventTriggers } from '@nao/shared/types';
import { Badge } from '@/components/ui/badge';
import { useTimeAgo } from '@/hooks/use-time-ago';
import { getAutomationTriggerLabel, getEnabledNaoEvents, NAO_EVENT_LABELS } from '@/lib/automation-triggers';
import { cn } from '@/lib/utils';

export type AutomationSummary = {
	id: string;
	title: string;
	enabled: boolean;
	scheduleDescription: string | null;
	cron: string;
	webhookEnabled: boolean;
	eventTriggers: AutomationEventTriggers;
	lastRunStartedAt: Date | string | null;
};

export function AutomationsList({
	items,
	isLoading,
	canCreateAutomation,
}: {
	items: AutomationSummary[];
	isLoading: boolean;
	canCreateAutomation: boolean;
}) {
	if (isLoading && items.length === 0) {
		return <AutomationsListSkeleton />;
	}
	if (items.length === 0) {
		return <AutomationsListEmptyState canCreateAutomation={canCreateAutomation} />;
	}
	return (
		<ul className='flex flex-col divide-y rounded-xl border bg-background/60 shadow-xs'>
			{items.map((item) => (
				<AutomationsListRow key={item.id} item={item} />
			))}
		</ul>
	);
}

function AutomationsListRow({ item }: { item: AutomationSummary }) {
	const lastRunMs = item.lastRunStartedAt ? new Date(item.lastRunStartedAt).getTime() : 0;
	const lastRunAgo = useTimeAgo(lastRunMs);
	const lastRunLabel = item.lastRunStartedAt ? `Last run ${lastRunAgo.humanReadable}` : 'Never run';

	return (
		<li>
			<Link
				to='/automations/$automationId'
				params={{ automationId: item.id }}
				className='flex items-center justify-between gap-4 px-4 py-3 transition-colors hover:bg-muted/50'
			>
				<div className='flex min-w-0 flex-col gap-0.5'>
					<span className='truncate text-sm font-medium'>{item.title}</span>
					<span className='truncate text-xs text-muted-foreground'>{getAutomationTriggerLabel(item)}</span>
				</div>
				<div className='flex shrink-0 items-center gap-3'>
					<span className={cn('text-xs text-muted-foreground', !item.lastRunStartedAt && 'italic')}>
						{lastRunLabel}
					</span>
					<AutomationStatusBadge item={item} />
				</div>
			</Link>
		</li>
	);
}

function AutomationStatusBadge({ item }: { item: AutomationSummary }) {
	if (!item.cron) {
		const eventTriggerLabel = getEventTriggerBadgeLabel(item);
		if (!eventTriggerLabel) {
			return null;
		}
		return (
			<Badge variant='secondary' className='px-1.5 py-0 text-[10px]'>
				{eventTriggerLabel}
			</Badge>
		);
	}
	return (
		<Badge variant={item.enabled ? 'default' : 'secondary'} className='px-1.5 py-0 text-[10px]'>
			{item.enabled ? 'On' : 'Paused'}
		</Badge>
	);
}

function getEventTriggerBadgeLabel(item: AutomationSummary): string | null {
	if (item.webhookEnabled) {
		return 'Webhook';
	}
	const [firstEvent] = getEnabledNaoEvents(item.eventTriggers);
	return firstEvent ? NAO_EVENT_LABELS[firstEvent] : null;
}

function AutomationsListSkeleton() {
	return (
		<div className='flex flex-col gap-2'>
			{[0, 1, 2].map((i) => (
				<div key={i} className='h-14 w-full animate-pulse rounded-md bg-muted' />
			))}
		</div>
	);
}

function AutomationsListEmptyState({ canCreateAutomation }: { canCreateAutomation: boolean }) {
	return (
		<div className='flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed bg-background/40 p-10 text-center'>
			<Timer className='size-8 text-muted-foreground' />
			<h2 className='font-medium'>No automations yet</h2>
			<p className='text-sm text-muted-foreground'>
				{canCreateAutomation
					? 'Create your first automation to get started.'
					: 'Automations created in this project will appear here.'}
			</p>
		</div>
	);
}
