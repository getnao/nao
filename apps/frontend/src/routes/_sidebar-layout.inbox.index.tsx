import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { CheckCheck, Columns2, Rows3 } from 'lucide-react';
import { useMemo, useState } from 'react';

import type { AutomationFeedItem, InboxLayout, NotificationFeedItem } from '@/components/automations-feed';
import type { FeedReadStatus } from '@/components/feed-filter-bar';
import { AutomationsFeed, inboxLayoutStorage } from '@/components/automations-feed';
import { applyFeedFilters, FeedFilterBar, useFeedFilters } from '@/components/feed-filter-bar';
import { MobileHeader } from '@/components/mobile-header';
import { Button } from '@/components/ui/button';
import { IconSegmentedToggle } from '@/components/ui/icon-segmented-toggle';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { SimpleTooltip } from '@/components/ui/tooltip';
import { useEffectiveUserGroupFeatures } from '@/hooks/use-effective-user-group-features';
import { useLocalStorage } from '@/hooks/use-local-storage';
import { usePermissions } from '@/hooks/use-permissions';
import { useSession } from '@/lib/auth-client';
import { trpc } from '@/main';
import {
	NOTIFICATION_LIST_LIMIT,
	useNotificationMutations,
	useNotifications,
	useUnreadAutomationRunCount,
	useUnreadCount,
} from '@/queries/use-notifications';

const READ_STATUS_OPTIONS: { value: FeedReadStatus; label: string }[] = [
	{ value: 'all', label: 'All' },
	{ value: 'unread', label: 'Unread' },
];

const LAYOUT_OPTIONS: { value: InboxLayout; label: string; icon: typeof Columns2 }[] = [
	{ value: 'split', label: 'Reading pane', icon: Columns2 },
	{ value: 'rows', label: 'Rows', icon: Rows3 },
];

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

	function handleSetRead(item: AutomationFeedItem, read: boolean) {
		const readAt = read ? new Date() : null;
		if (read) {
			setReadThisVisitIds((ids) => new Set(ids).add(item.id));
		}
		if (item.kind === 'automation') {
			const queryKey = trpc.automation.feed.queryKey({});
			queryClient.setQueryData(queryKey, (runs) =>
				runs?.map((run) => (run.run.id === item.run.id ? { ...run, run: { ...run.run, readAt } } : run)),
			);
			markRunRead.mutate(
				{ runId: item.run.id, read },
				{ onError: () => queryClient.invalidateQueries({ queryKey }) },
			);
		} else {
			const queryKey = trpc.notification.list.queryKey({ limit: NOTIFICATION_LIST_LIMIT });
			queryClient.setQueryData(queryKey, (list) =>
				list?.map((notification) =>
					notification.id === item.notification.id ? { ...notification, readAt } : notification,
				),
			);
			markRead.mutate(
				{ notificationId: item.notification.id, read },
				{ onError: () => queryClient.invalidateQueries({ queryKey }) },
			);
		}
	}

	function handleReadStatusChange(readStatus: FeedReadStatus) {
		setReadThisVisitIds(new Set());
		setFilters({ ...filters, readStatus });
	}

	function handleMarkAllRead() {
		markAllRead.mutate();
		if (automationsEnabled) {
			markAllRunsRead.mutate();
		}
	}

	const automationItems = automations.data ?? [];
	const notificationItems = useMemo(
		() => [...MOCK_STORY_HEALTH, ...(notifications.data ?? [])].map(toNotificationFeedItem),
		[notifications.data],
	);
	const feedItems = useMemo(() => mergeFeedItems(feed.data ?? [], notificationItems), [feed.data, notificationItems]);
	const unreadNotificationCount = useUnreadCount(project.data?.id).data ?? 0;
	const unreadRunCount = useUnreadAutomationRunCount(automationsEnabled, project.data?.id).data ?? 0;
	const hasUnread = unreadNotificationCount > 0 || unreadRunCount > 0;
	const [filters, setFilters] = useFeedFilters();
	const [readThisVisitIds, setReadThisVisitIds] = useState<ReadonlySet<string>>(() => new Set());
	const [layout, setLayout] = useLocalStorage(inboxLayoutStorage);
	const displayedItems = useMemo(
		() => applyFeedFilters(feedItems, filters, currentUserName, readThisVisitIds),
		[feedItems, filters, currentUserName, readThisVisitIds],
	);
	const isLoading = notifications.isLoading || (automationsEnabled && feed.isLoading);

	return (
		<div className='flex h-full flex-1 flex-col overflow-hidden bg-background'>
			<MobileHeader />
			<header className='flex items-center justify-between gap-3 border-b px-4 py-3 md:px-6'>
				<h1 className='text-lg font-semibold tracking-tight'>Inbox</h1>
				<div className='flex items-center gap-1'>
					<IconSegmentedToggle
						options={LAYOUT_OPTIONS}
						value={layout}
						onValueChange={setLayout}
						className='mr-2 hidden md:flex'
					/>
					<SegmentedControl
						label='Show'
						options={READ_STATUS_OPTIONS}
						value={filters.readStatus}
						onChange={handleReadStatusChange}
						className='mr-1'
					/>
					{!isLoading && feedItems.length > 0 && (
						<FeedFilterBar
							filters={filters}
							onChange={setFilters}
							items={feedItems}
							showAutomations={automationsEnabled}
							currentUserName={currentUserName}
						/>
					)}
					<SimpleTooltip content='Mark all as read'>
						<Button
							variant='ghost'
							className='h-8 px-2 text-muted-foreground'
							aria-label='Mark all as read'
							onClick={handleMarkAllRead}
							disabled={!hasUnread || markAllRead.isPending || markAllRunsRead.isPending}
						>
							<CheckCheck className='size-4' />
						</Button>
					</SimpleTooltip>
				</div>
			</header>

			{!isLoading && feedItems.length > 0 && displayedItems.length === 0 ? (
				<FeedNoMatches isUnreadOnly={filters.readStatus === 'unread'} />
			) : (
				<AutomationsFeed
					items={displayedItems}
					layout={layout}
					isLoading={isLoading}
					hasAutomations={automationItems.length > 0}
					canCreateAutomation={canCreateAutomation}
					onSetRead={handleSetRead}
					onCancelRun={handleCancelRun}
					cancellingRunId={cancelRun.isPending ? (cancelRun.variables?.runId ?? null) : null}
					onOpenNotification={handleOpenNotification}
				/>
			)}
		</div>
	);
}

function FeedNoMatches({ isUnreadOnly }: { isUnreadOnly: boolean }) {
	return (
		<div className='flex flex-1 flex-col items-center justify-center px-4 py-16 text-center'>
			<CheckCheck className='mb-3 size-6 text-muted-foreground' />
			<h2 className='text-sm font-medium'>{isUnreadOnly ? 'You are all caught up' : 'No matching activity'}</h2>
			<p className='mt-1 text-sm text-muted-foreground'>
				{isUnreadOnly
					? 'Nothing unread matches your filters.'
					: 'Nothing matches your current filters. Try clearing or adjusting them.'}
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

function isFeedItemRunning(item: AutomationFeedItem): boolean {
	if (item.kind === 'automation') {
		return item.run.status === 'running';
	}
	return false;
}

const MOCK_STORY_HEALTH: NotificationListItem[] = [
	{
		id: 'mock-cost',
		category: 'story_health',
		title: 'Jaffle Shop orders: volume, fulfillment and value cost $4.12 yesterday',
		body: 'Above your $2.00 daily limit. It refreshed 96 times since its schedule moved to every 15 minutes, and each refresh rewrites the live text with claude-sonnet-5-5.',
		linkUrl: '/stories/ed973d1f-a524-4955-b515-c4c3c5d37ea5',
		payload: { kind: 'cost' },
		readAt: null,
		createdAt: new Date(Date.now() - 2 * 3_600_000),
	},
	{
		id: 'mock-delivery',
		category: 'story_health',
		title: 'Jaffle Shop orders: volume, fulfillment and value was partly delivered',
		body: 'Email reached 12 of 12 recipients. Slack failed: nao was removed from #sales-weekly.',
		linkUrl: '/stories/ed973d1f-a524-4955-b515-c4c3c5d37ea5',
		payload: { kind: 'delivery' },
		readAt: null,
		createdAt: new Date(Date.now() - 3 * 3_600_000),
	},
];
