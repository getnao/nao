import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { CheckCheck, Timer } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import type { AutomationFeedItem, NotificationFeedItem } from '@/components/automations-feed';
import { AutomationsFeed } from '@/components/automations-feed';
import { applyFeedFilters, FeedFilterBar, useFeedFilters } from '@/components/feed-filter-bar';
import { MobileHeader } from '@/components/mobile-header';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useEffectiveUserGroupFeatures } from '@/hooks/use-effective-user-group-features';
import { usePermissions } from '@/hooks/use-permissions';
import { useSession } from '@/lib/auth-client';
import { getActiveProjectId } from '@/lib/active-project';
import { trpc } from '@/main';
import {
	useNotificationMutations,
	useNotifications,
	useUnreadAutomationRunCount,
	useUnreadCount,
} from '@/queries/use-notifications';

export const Route = createFileRoute('/_sidebar-layout/inbox/')({
	component: InboxPage,
});

function InboxPage() {
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const { data: session } = useSession();
	const currentUserName = session?.user?.name ?? null;
	const { isViewer } = usePermissions();
	const config = useQuery(trpc.system.getPublicConfig.queryOptions());
	const automationsEnabled = config.data?.betaAutomationsEnabled === true && !isViewer;
	const project = useQuery(trpc.project.getCurrent.queryOptions());
	const { automationCreationEnabled } = useEffectiveUserGroupFeatures();
	const canCreateAutomation = automationsEnabled && automationCreationEnabled;

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
			<div className='mx-auto flex w-full max-w-4xl flex-col gap-6 px-4 py-6 md:px-8 md:py-10'>
				<header className='flex items-center justify-between gap-3 flex-wrap'>
					<div>
						<h1 className='text-xl font-semibold tracking-tight'>Inbox</h1>
						<p className='text-sm text-muted-foreground'>
							Catch up on all your activity and notifications. Latest first.
						</p>
					</div>
					<div className='flex items-center gap-2'>
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
					</div>
				</header>

				<section className='mx-auto w-full'>
					{!isLoading && feedItems.length > 0 && displayedItems.length === 0 ? (
						<FeedNoMatches />
					) : (
						<AutomationsFeed
							items={displayedItems}
							isLoading={isLoading}
							hasAutomations={automationItems.length > 0}
							canCreateAutomation={canCreateAutomation}
							lastSeenAt={filters.sort === 'newest' ? lastSeenAt : 0}
							onCancelRun={handleCancelRun}
							cancellingRunId={cancelRun.isPending ? (cancelRun.variables?.runId ?? null) : null}
							onOpenNotification={handleOpenNotification}
							onOpenAutomation={handleOpenAutomation}
						/>
					)}
				</section>
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
