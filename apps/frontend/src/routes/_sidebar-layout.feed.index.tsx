import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { Plus, Timer, X } from 'lucide-react';
import { useEffect, useState } from 'react';

import type { AutomationFormValue } from '@/components/automations-form';
import type { AutomationFeedItem } from '@/components/automations-feed';
import { AutomationForm } from '@/components/automations-form';
import { AutomationsFeed } from '@/components/automations-feed';
import { MobileHeader } from '@/components/mobile-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { SettingsCard } from '@/components/ui/settings-card';
import { useTimeAgo } from '@/hooks/use-time-ago';
import { getActiveProjectId } from '@/lib/active-project';
import { requireAutomationsEnabled } from '@/lib/require-admin';
import { cn } from '@/lib/utils';
import { trpc } from '@/main';

export const Route = createFileRoute('/_sidebar-layout/feed/')({
	beforeLoad: requireAutomationsEnabled,
	component: AutomationsPage,
});

function AutomationsPage() {
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const [isCreating, setIsCreating] = useState(false);

	const automations = useQuery(trpc.automation.list.queryOptions());
	const feed = useQuery(
		trpc.automation.feed.queryOptions(
			{},
			{
				refetchInterval: (query) => (query.state.data?.some(isFeedItemRunning) ? 1_500 : false),
			},
		),
	);
	const createAutomation = useMutation(trpc.automation.create.mutationOptions());
	const cancelRun = useMutation(trpc.automation.cancelRun.mutationOptions());

	async function handleCreate(value: AutomationFormValue) {
		const created = await createAutomation.mutateAsync(value);
		await queryClient.invalidateQueries({ queryKey: trpc.automation.list.queryKey() });
		setIsCreating(false);
		navigate({ to: '/automations/$automationId', params: { automationId: created.id } });
	}

	async function handleCancelRun(runId: string) {
		await cancelRun.mutateAsync({ runId });
		await queryClient.invalidateQueries({ queryKey: trpc.automation.feed.queryKey() });
	}

	const automationItems = automations.data ?? [];
	const feedItems = feed.data ?? [];
	const lastSeenAt = useFeedLastSeen(feedItems);

	return (
		<div className='flex flex-col flex-1 h-full overflow-auto bg-background'>
			<MobileHeader />
			<div className='mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-6 md:px-8 md:py-10'>
				<header className='flex items-center justify-between gap-3 flex-wrap'>
					<div>
						<h1 className='text-xl font-semibold tracking-tight'>Feed</h1>
						<p className='text-sm text-muted-foreground'>
							Catch up on all your activity (automations, stories). Latest first.
						</p>
					</div>
					<Button variant='primary-gradient' onClick={() => setIsCreating((value) => !value)}>
						{isCreating ? <X className='size-4' /> : <Plus className='size-4' />}
						{isCreating ? 'Cancel' : 'New automation'}
					</Button>
				</header>

				{isCreating && (
					<SettingsCard title='New automation'>
						<AutomationForm
							submitLabel='Create automation'
							isPending={createAutomation.isPending}
							onSubmit={handleCreate}
						/>
					</SettingsCard>
				)}

				<div className='grid gap-6 lg:grid-cols-[minmax(0,1fr)_18rem]'>
					<section className='mx-auto w-full '>
						<AutomationsFeed
							items={feedItems}
							isLoading={feed.isLoading}
							hasAutomations={automationItems.length > 0}
							lastSeenAt={lastSeenAt}
							onCancelRun={handleCancelRun}
							cancellingRunId={cancelRun.isPending ? (cancelRun.variables?.runId ?? null) : null}
						/>
					</section>
					<aside className='lg:sticky lg:top-6 lg:self-start'>
						<AutomationsSidePanel items={automationItems} isLoading={automations.isLoading} />
					</aside>
				</div>
			</div>
		</div>
	);
}

const FEED_LAST_SEEN_KEY_PREFIX = 'nao.automation-feed-last-seen:';

/**
 * Captures the persisted last-seen timestamp once on mount so the "new since
 * last visit" separator stays stable during the session, while continuously
 * updating localStorage as new runs come in for the next visit.
 */
function useFeedLastSeen(items: AutomationFeedItem[]): number {
	const [lastSeenAt] = useState<number>(() => readLastSeenAt());

	useEffect(() => {
		if (items.length === 0) {
			return;
		}
		const latest = items.reduce((max, item) => {
			const ts = new Date(item.startedAt).getTime();
			return ts > max ? ts : max;
		}, 0);
		if (latest > 0) {
			writeLastSeenAt(latest);
		}
	}, [items]);

	return lastSeenAt;
}

function isFeedItemRunning(item: AutomationFeedItem): boolean {
	if (item.kind === 'automation') {
		return item.run.status === 'running';
	}
	return item.activity.status === 'running';
}

function getFeedLastSeenKey(): string | null {
	const projectId = getActiveProjectId();
	return projectId ? `${FEED_LAST_SEEN_KEY_PREFIX}${projectId}` : null;
}

function readLastSeenAt(): number {
	if (typeof window === 'undefined') {
		return 0;
	}
	const key = getFeedLastSeenKey();
	if (!key) {
		return 0;
	}
	const stored = window.localStorage.getItem(key);
	const parsed = stored ? Number(stored) : 0;
	return Number.isFinite(parsed) ? parsed : 0;
}

function writeLastSeenAt(value: number): void {
	if (typeof window === 'undefined') {
		return;
	}
	const key = getFeedLastSeenKey();
	if (!key) {
		return;
	}
	window.localStorage.setItem(key, String(value));
}

type AutomationSummary = {
	id: string;
	title: string;
	enabled: boolean;
	scheduleDescription: string | null;
	cron: string;
	lastRunStartedAt: Date | string | null;
};

function AutomationsSidePanel({ items, isLoading }: { items: AutomationSummary[]; isLoading: boolean }) {
	return (
		<div className='rounded-xl border bg-background/60 p-3 shadow-xs'>
			<div className='flex items-center justify-between px-1 pb-2'>
				<h2 className='text-sm font-medium'>Your automations</h2>
				{items.length > 0 && <span className='text-xs text-muted-foreground'>{items.length}</span>}
			</div>
			{isLoading && items.length === 0 ? (
				<SidePanelSkeleton />
			) : items.length === 0 ? (
				<SidePanelEmptyState />
			) : (
				<ul className='flex flex-col'>
					{items.map((item) => (
						<AutomationSidePanelRow key={item.id} item={item} />
					))}
				</ul>
			)}
		</div>
	);
}

function AutomationSidePanelRow({ item }: { item: AutomationSummary }) {
	const lastRunMs = item.lastRunStartedAt ? new Date(item.lastRunStartedAt).getTime() : 0;
	const lastRunAgo = useTimeAgo(lastRunMs);
	const lastRunLabel = item.lastRunStartedAt ? lastRunAgo.humanReadable : 'Never run';

	return (
		<li>
			<Link
				to='/automations/$automationId'
				params={{ automationId: item.id }}
				className='group flex flex-col gap-0.5 rounded-md px-2 py-2 transition-colors hover:bg-muted/50'
			>
				<div className='flex items-center justify-between gap-2'>
					<span className='truncate text-sm font-medium'>{item.title}</span>
					<Badge
						variant={item.enabled ? 'default' : 'secondary'}
						className='shrink-0 px-1.5 py-0 text-[10px]'
					>
						{item.enabled ? 'On' : 'Paused'}
					</Badge>
				</div>
				<span className='truncate text-xs text-muted-foreground'>
					{item.scheduleDescription || item.cron || 'Custom schedule'}
				</span>
				<span className={cn('text-[11px] text-muted-foreground/80', !item.lastRunStartedAt && 'italic')}>
					{lastRunLabel}
				</span>
			</Link>
		</li>
	);
}

function SidePanelSkeleton() {
	return (
		<div className='flex flex-col gap-2 p-2'>
			{[0, 1, 2].map((i) => (
				<div key={i} className='h-12 w-full animate-pulse rounded-md bg-muted' />
			))}
		</div>
	);
}

function SidePanelEmptyState() {
	return (
		<div className='flex flex-col items-center justify-center gap-2 px-3 py-6 text-center'>
			<Timer className='size-5 text-muted-foreground' />
			<p className='text-xs text-muted-foreground'>No automations yet. Create one to get started.</p>
		</div>
	);
}
