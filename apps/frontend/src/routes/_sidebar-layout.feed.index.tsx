import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { CheckCheck, Plus, Timer, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import type { AutomationFormValue } from '@/components/automations-form';
import type { AutomationFeedItem, NotificationFeedItem } from '@/components/automations-feed';
import { AutomationForm } from '@/components/automations-form';
import { AutomationsFeed } from '@/components/automations-feed';
import { applyFeedFilters, FeedFilterBar, useFeedFilters } from '@/components/feed-filter-bar';
import { MobileHeader } from '@/components/mobile-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { SettingsCard } from '@/components/ui/settings-card';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useTimeAgo } from '@/hooks/use-time-ago';
import { usePermissions } from '@/hooks/use-permissions';
import { useSession } from '@/lib/auth-client';
import { getActiveProjectId } from '@/lib/active-project';
import { cn } from '@/lib/utils';
import { trpc } from '@/main';
import {
	useNotificationMutations,
	useNotifications,
	useUnreadAutomationRunCount,
	useUnreadCount,
} from '@/queries/use-notifications';

export const Route = createFileRoute('/_sidebar-layout/feed/')({
	component: FeedPage,
});

function FeedPage() {
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const { data: session } = useSession();
	const currentUserName = session?.user?.name ?? null;
	const { isViewer } = usePermissions();
	const config = useQuery(trpc.system.getPublicConfig.queryOptions());
	const automationsEnabled = config.data?.betaAutomationsEnabled === true && !isViewer;
	const project = useQuery(trpc.project.getCurrent.queryOptions());
	const [isCreating, setIsCreating] = useState(false);

	const automations = useQuery({ ...trpc.automation.list.queryOptions(), enabled: automationsEnabled });
	const feed = useQuery(
		trpc.automation.feed.queryOptions(
			{},
			{
				enabled: automationsEnabled,
				refetchInterval: (query) => (query.state.data?.some(isFeedItemRunning) ? 1_500 : false),
			},
		),
	);
	const notifications = useNotifications(true);
	const { markRead, markAllRead } = useNotificationMutations();
	const createAutomation = useMutation(trpc.automation.create.mutationOptions());
	const cancelRun = useMutation(trpc.automation.cancelRun.mutationOptions());
	const invalidateAutomationFeedCaches = () =>
		Promise.all([
			queryClient.invalidateQueries({ queryKey: trpc.automation.feed.queryKey() }),
			queryClient.invalidateQueries({ queryKey: trpc.automation.unreadCount.queryKey() }),
		]);
	const markRunRead = useMutation(
		trpc.automation.markRunRead.mutationOptions({ onSuccess: invalidateAutomationFeedCaches }),
	);
	const markAllRunsRead = useMutation(
		trpc.automation.markAllRunsRead.mutationOptions({ onSuccess: invalidateAutomationFeedCaches }),
	);

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

	function handleOpenNotification(notificationId: string, linkUrl: string | null) {
		markRead.mutate({ notificationId });
		if (linkUrl) {
			navigate({ to: linkUrl });
		}
	}

	function handleOpenAutomation(runId: string) {
		markRunRead.mutate({ runId });
	}

	function handleMarkAllRead() {
		markAllRead.mutate();
		if (automationsEnabled) {
			markAllRunsRead.mutate();
		}
	}

	const automationItems = automations.data ?? [];
	const notificationItems = useMemo(
		() => (notifications.data ?? []).map(toNotificationFeedItem),
		[notifications.data],
	);
	const feedItems = useMemo(() => mergeFeedItems(feed.data ?? [], notificationItems), [feed.data, notificationItems]);
	const unreadNotificationCount = useUnreadCount(project.data?.id).data ?? 0;
	const unreadRunCount = useUnreadAutomationRunCount(automationsEnabled, project.data?.id).data ?? 0;
	const hasUnread = unreadNotificationCount > 0 || unreadRunCount > 0;
	const [filters, setFilters] = useFeedFilters();
	const displayedItems = useMemo(
		() => applyFeedFilters(feedItems, filters, currentUserName),
		[feedItems, filters, currentUserName],
	);
	const lastSeenAt = useFeedLastSeen(feedItems);
	const isLoading = notifications.isLoading || (automationsEnabled && feed.isLoading);

	return (
		<div className='flex flex-col flex-1 h-full overflow-auto bg-background'>
			<MobileHeader />
			<div className='mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-6 md:px-8 md:py-10'>
				<header className='flex items-center justify-between gap-3 flex-wrap'>
					<div>
						<h1 className='text-xl font-semibold tracking-tight'>Feed</h1>
						<p className='text-sm text-muted-foreground'>
							Catch up on all your activity and notifications. Latest first.
						</p>
					</div>
					<div className='flex items-center gap-2 lg:gap-0'>
						{hasUnread && (
							<Tooltip>
								<TooltipTrigger asChild>
									<Button
										variant='ghost'
										size='icon'
										onClick={handleMarkAllRead}
										disabled={markAllRead.isPending || markAllRunsRead.isPending}
									>
										<CheckCheck className='size-4' />
									</Button>
								</TooltipTrigger>
								<TooltipContent>Mark all as read</TooltipContent>
							</Tooltip>
						)}
						{!isLoading && feedItems.length > 0 && (
							<FeedFilterBar
								filters={filters}
								onChange={setFilters}
								items={feedItems}
								showAutomations={automationsEnabled}
								currentUserName={currentUserName}
							/>
						)}
						{automationsEnabled && (
							<div className='flex justify-end lg:w-[19.5rem]'>
								<Button variant='primary-gradient' onClick={() => setIsCreating((value) => !value)}>
									{isCreating ? <X className='size-4' /> : <Plus className='size-4' />}
									{isCreating ? 'Cancel' : 'New automation'}
								</Button>
							</div>
						)}
					</div>
				</header>

				{automationsEnabled && isCreating && (
					<SettingsCard title='New automation'>
						<AutomationForm
							submitLabel='Create automation'
							isPending={createAutomation.isPending}
							onSubmit={handleCreate}
						/>
					</SettingsCard>
				)}

				<div className={cn('grid gap-6', automationsEnabled && 'lg:grid-cols-[minmax(0,1fr)_18rem]')}>
					<section className='mx-auto w-full'>
						{!isLoading && feedItems.length > 0 && displayedItems.length === 0 ? (
							<FeedNoMatches />
						) : (
							<AutomationsFeed
								items={displayedItems}
								isLoading={isLoading}
								hasAutomations={automationItems.length > 0}
								lastSeenAt={filters.sort === 'newest' ? lastSeenAt : 0}
								onCancelRun={handleCancelRun}
								cancellingRunId={cancelRun.isPending ? (cancelRun.variables?.runId ?? null) : null}
								onOpenNotification={handleOpenNotification}
								onOpenAutomation={handleOpenAutomation}
							/>
						)}
					</section>
					{automationsEnabled && (
						<aside className='lg:sticky lg:top-6 lg:self-start'>
							<AutomationsSidePanel items={automationItems} isLoading={automations.isLoading} />
						</aside>
					)}
				</div>
			</div>
		</div>
	);
}

function FeedNoMatches() {
	return (
		<div className='flex flex-col items-center justify-center rounded-xl border border-dashed bg-background/40 p-10 text-center'>
			<Timer className='size-8 text-muted-foreground mb-3' />
			<h2 className='font-medium'>No matching activity</h2>
			<p className='mt-1 text-sm text-muted-foreground'>
				Nothing matches your current filters. Try clearing or adjusting them.
			</p>
		</div>
	);
}

type NotificationListItem = {
	id: string;
	category: NotificationFeedItem['notification']['category'];
	title: string;
	body: string | null;
	linkUrl: string | null;
	payload: Record<string, unknown> | null;
	readAt: Date | string | null;
	createdAt: Date | string;
};

function toNotificationFeedItem(notification: NotificationListItem): NotificationFeedItem {
	return {
		kind: 'notification',
		id: `notification:${notification.id}`,
		startedAt: notification.createdAt,
		notification: {
			id: notification.id,
			category: notification.category,
			title: notification.title,
			body: notification.body,
			linkUrl: notification.linkUrl,
			payload: notification.payload,
			readAt: notification.readAt,
		},
	};
}

function mergeFeedItems(activity: AutomationFeedItem[], notifications: NotificationFeedItem[]): AutomationFeedItem[] {
	return [...activity, ...notifications].sort(
		(a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime(),
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
	return false;
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
	webhookEnabled: boolean;
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
	const hasSchedule = Boolean(item.cron);
	const triggerLabel = buildTriggerLabel(item);

	return (
		<li>
			<Link
				to='/automations/$automationId'
				params={{ automationId: item.id }}
				className='group flex flex-col gap-0.5 rounded-md px-2 py-2 transition-colors hover:bg-muted/50'
			>
				<div className='flex items-center justify-between gap-2'>
					<span className='truncate text-sm font-medium'>{item.title}</span>
					<AutomationStatusBadge
						enabled={item.enabled}
						hasSchedule={hasSchedule}
						webhookEnabled={item.webhookEnabled}
					/>
				</div>
				<span className='truncate text-xs text-muted-foreground'>{triggerLabel}</span>
				<span className={cn('text-[11px] text-muted-foreground/80', !item.lastRunStartedAt && 'italic')}>
					{lastRunLabel}
				</span>
			</Link>
		</li>
	);
}

function AutomationStatusBadge({
	enabled,
	hasSchedule,
	webhookEnabled,
}: {
	enabled: boolean;
	hasSchedule: boolean;
	webhookEnabled: boolean;
}) {
	if (!hasSchedule) {
		if (!webhookEnabled) {
			return null;
		}
		return (
			<Badge variant='secondary' className='shrink-0 px-1.5 py-0 text-[10px]'>
				Webhook
			</Badge>
		);
	}
	return (
		<Badge variant={enabled ? 'default' : 'secondary'} className='shrink-0 px-1.5 py-0 text-[10px]'>
			{enabled ? 'On' : 'Paused'}
		</Badge>
	);
}

/**
 * Surfaces every active trigger so a paused schedule badge is not mistaken for
 * the automation having no webhook. A paused automation stops all triggers,
 * including the webhook.
 */
function buildTriggerLabel(item: AutomationSummary): string {
	if (item.cron) {
		const scheduleText = item.scheduleDescription || item.cron;
		return item.webhookEnabled ? `${scheduleText} · webhook` : scheduleText;
	}
	return item.webhookEnabled ? 'Triggered by webhook' : 'Custom schedule';
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
