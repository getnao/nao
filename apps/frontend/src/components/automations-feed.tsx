import { stripAssistantTags } from '@nao/shared';
import { isBuiltinChartType } from '@nao/shared/chart-types';
import { Link } from '@tanstack/react-router';
import {
	ArrowRightLeft,
	ArrowUpRight,
	Bell,
	BellPlus,
	BotIcon,
	ChartColumn,
	ChevronLeft,
	ChevronRight,
	EyeOff,
	FlaskConical,
	InboxIcon,
	Loader2,
	Mail,
	MailOpen,
	MessageSquare,
	RefreshCw,
	Share2,
	ThumbsDown,
	ThumbsUp,
	Wallet,
} from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Streamdown } from 'streamdown';
import { splitCodeIntoSegments } from '@nao/shared/story-segments';
import { NOTIFICATION_CATEGORY_LABELS } from '@nao/shared/types';
import type { displayChart } from '@nao/shared/tools';
import type { ParsedChartBlock, ParsedMapBlock, ParsedTableBlock } from '@nao/shared/story-segments';
import type {
	FeedbackNotificationPayload,
	NotificationCategory,
	SharedNotificationPayload,
	ShareRole,
	StoryRefreshNotificationPayload,
	StorySubscriptionNotificationPayload,
	StoryTransferNotificationPayload,
} from '@nao/shared/types';
import type { ComponentType, ReactNode } from 'react';

import type { QueryDataMap } from '@/components/story-embeds';
import GithubIcon from '@/components/icons/github-icon.svg';
import SlackIcon from '@/components/icons/slack.svg';
import { SegmentList } from '@/components/story-rendering';
import { StoryChartEmbed, StoryMapEmbed, StoryTableEmbed } from '@/components/story-embeds';
import { getFeedItemActor, isFeedItemUnread } from '@/components/feed-filter-bar';
import { ChartDisplay } from '@/components/tool-calls/display-chart';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { SimpleTooltip, Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useLocalStorage } from '@/hooks/use-local-storage';
import { useTimeAgo } from '@/hooks/use-time-ago';
import { createLocalStorage } from '@/lib/local-storage';
import { cn } from '@/lib/utils';
import { trpc } from '@/main';
import { markdownLinkSafety } from '@/components/external-link-dialog';

export type AutomationFeedRunStatus = 'running' | 'completed' | 'failed' | 'cancelled';

export type AutomationFeedIntegrationResult = {
	type: string;
	label: string;
	ok: boolean;
	message?: string | null;
	url?: string | null;
};

export type AutomationFeedChart = {
	toolCallId: string;
	config: displayChart.ChartInput;
	data: unknown[];
};

export type AutomationFeedAutomationItem = {
	kind: 'automation';
	id: string;
	startedAt: string | Date;
	run: {
		id: string;
		automationId: string;
		status: AutomationFeedRunStatus;
		startedAt: string | Date;
		completedAt: string | Date | null;
		errorMessage?: string | null;
		chatId: string | null;
		integrationResults: AutomationFeedIntegrationResult[];
		readAt: string | Date | null;
	};
	automation: {
		id: string;
		title: string;
		scheduleDescription?: string | null;
		cron: string;
	};
	output: {
		text: string | null;
		charts: AutomationFeedChart[];
	};
};

export type ShareVisibility = 'project' | 'specific';

export type NotificationFeedItem = {
	kind: 'notification';
	id: string;
	startedAt: string | Date;
	notification: {
		id: string;
		category: NotificationCategory;
		title: string;
		body: string | null;
		linkUrl: string | null;
		payload: Record<string, unknown> | null;
		readAt: string | Date | null;
	};
};

export type AutomationFeedItem = AutomationFeedAutomationItem | NotificationFeedItem;

export type InboxLayout = 'split' | 'rows';

export const inboxLayoutStorage = createLocalStorage<InboxLayout>('nao.inbox-layout', 'split');
const chartsHiddenStorage = createLocalStorage<boolean>('nao.inbox-charts-hidden', false);

type FeedIconTone = 'default' | 'destructive' | 'muted';

const FEED_ICON_TONE_CLASSES: Record<FeedIconTone, string> = {
	default: 'bg-muted text-muted-foreground',
	destructive: 'bg-destructive/10 text-destructive',
	muted: 'bg-muted/60 text-muted-foreground/60',
};

type FeedActions = {
	onSetRead?: (item: AutomationFeedItem, read: boolean) => void;
	onCancelRun?: (runId: string) => void;
	cancellingRunId?: string | null;
	onOpenNotification?: (notificationId: string, linkUrl: string | null) => void;
};

type FeedShortcut = 'next' | 'previous' | 'open' | 'toggleRead';

const FEED_SHORTCUTS: Record<string, FeedShortcut> = {
	j: 'next',
	ArrowDown: 'next',
	k: 'previous',
	ArrowUp: 'previous',
	o: 'open',
	Enter: 'open',
	u: 'toggleRead',
};

export function AutomationsFeed({
	items,
	layout = 'split',
	isLoading,
	hasAutomations,
	canCreateAutomation,
	...actions
}: FeedActions & {
	items: AutomationFeedItem[];
	layout?: InboxLayout;
	isLoading: boolean;
	hasAutomations: boolean;
	canCreateAutomation: boolean;
}) {
	if (isLoading && items.length === 0) {
		return <FeedSkeleton />;
	}

	if (items.length === 0) {
		return <FeedEmptyState hasAutomations={hasAutomations} canCreateAutomation={canCreateAutomation} />;
	}

	return layout === 'split' ? (
		<SplitInbox items={items} actions={actions} />
	) : (
		<RowsInbox items={items} actions={actions} />
	);
}

function SplitInbox({ items, actions }: { items: AutomationFeedItem[]; actions: FeedActions }) {
	const [selectedId, setSelectedId] = useState<string | null>(null);
	const selectedItem = items.find((item) => item.id === selectedId) ?? items[0];
	const toggleRead = (item: AutomationFeedItem) => actions.onSetRead?.(item, isFeedItemUnread(item));

	function select(item: AutomationFeedItem) {
		setSelectedId(item.id);
		markRead(item, actions);
	}

	useFeedKeyboard({ items, activeId: selectedItem.id, onActivate: select, onOpen: select, onToggleRead: toggleRead });

	return (
		<div className='flex min-h-0 flex-1'>
			<div
				className={cn(
					'w-full shrink-0 overflow-y-auto border-r md:w-[360px] lg:w-[420px]',
					selectedId && 'hidden md:block',
				)}
			>
				<DayGroups items={items}>
					{(item) => (
						<ItemSummary
							key={item.id}
							item={item}
							variant='stacked'
							isSelected={item.id === selectedItem.id}
							onSelect={() => select(item)}
							onToggleRead={() => toggleRead(item)}
						/>
					)}
				</DayGroups>
			</div>
			<div className={cn('min-w-0 flex-1 overflow-y-auto', !selectedId && 'hidden md:block')}>
				<div className='mx-auto flex max-w-3xl flex-col gap-4 px-4 py-6 md:px-10 md:py-8'>
					<Button
						variant='ghost'
						size='sm'
						className='-ml-2 self-start text-muted-foreground md:hidden'
						onClick={() => setSelectedId(null)}
					>
						<ChevronLeft className='size-4' />
						Inbox
					</Button>
					<ItemDetail key={selectedItem.id} item={selectedItem} actions={actions} />
				</div>
			</div>
		</div>
	);
}

function RowsInbox({ items, actions }: { items: AutomationFeedItem[]; actions: FeedActions }) {
	const [activeId, setActiveId] = useState<string | null>(null);
	const [expandedId, setExpandedId] = useState<string | null>(null);
	const toggleRead = (item: AutomationFeedItem) => actions.onSetRead?.(item, isFeedItemUnread(item));

	function toggleExpanded(item: AutomationFeedItem) {
		setActiveId(item.id);
		setExpandedId((current) => (current === item.id ? null : item.id));
		markRead(item, actions);
	}

	useFeedKeyboard({
		items,
		activeId,
		onActivate: (item) => setActiveId(item.id),
		onOpen: toggleExpanded,
		onToggleRead: toggleRead,
	});

	return (
		<div className='min-h-0 flex-1 overflow-y-auto'>
			<DayGroups items={items}>
				{(item) => (
					<div key={item.id}>
						<ItemSummary
							item={item}
							variant='inline'
							isSelected={item.id === activeId}
							onSelect={() => toggleExpanded(item)}
							onToggleRead={() => toggleRead(item)}
						/>
						{item.id === expandedId && (
							<div className='border-b bg-muted/20 px-4 py-6 md:pr-6 md:pl-[4.75rem]'>
								<div className='max-w-4xl'>
									<ItemDetail item={item} actions={actions} hideHeader />
								</div>
							</div>
						)}
					</div>
				)}
			</DayGroups>
		</div>
	);
}

/** Inbox shortcuts: j/k or arrows move, o or Enter opens, u toggles read. */
function useFeedKeyboard({
	items,
	activeId,
	onActivate,
	onOpen,
	onToggleRead,
}: {
	items: AutomationFeedItem[];
	activeId: string | null;
	onActivate: (item: AutomationFeedItem) => void;
	onOpen: (item: AutomationFeedItem) => void;
	onToggleRead: (item: AutomationFeedItem) => void;
}) {
	const handlers = useRef({ onActivate, onOpen, onToggleRead });
	handlers.current = { onActivate, onOpen, onToggleRead };

	useEffect(() => {
		function handleKeyDown(event: KeyboardEvent) {
			const shortcut = FEED_SHORTCUTS[event.key];
			if (!shortcut || event.metaKey || event.ctrlKey || event.altKey || isInteractiveTarget(event.target)) {
				return;
			}
			event.preventDefault();
			const index = items.findIndex((item) => item.id === activeId);
			if (shortcut === 'next' || shortcut === 'previous') {
				const nextIndex = shortcut === 'next' ? index + 1 : Math.max(index - 1, 0);
				const nextItem = items[Math.min(nextIndex, items.length - 1)];
				handlers.current.onActivate(nextItem);
				document.querySelector(`[data-feed-item="${nextItem.id}"]`)?.scrollIntoView({ block: 'nearest' });
				return;
			}
			const activeItem = items[index];
			if (activeItem) {
				handlers.current[shortcut === 'open' ? 'onOpen' : 'onToggleRead'](activeItem);
			}
		}
		window.addEventListener('keydown', handleKeyDown);
		return () => window.removeEventListener('keydown', handleKeyDown);
	}, [items, activeId]);
}

function isInteractiveTarget(target: EventTarget | null): boolean {
	return (
		target instanceof HTMLElement &&
		(target.isContentEditable || Boolean(target.closest('input, textarea, select, [role="dialog"], [role="menu"]')))
	);
}

function DayGroups({
	items,
	children,
}: {
	items: AutomationFeedItem[];
	children: (item: AutomationFeedItem) => ReactNode;
}) {
	return groupItemsByDay(items).map((group) => (
		<section key={group.label} aria-label={group.label}>
			<h2 className='sticky top-0 z-10 border-b bg-background/95 px-4 py-1.5 text-xs font-medium text-muted-foreground backdrop-blur md:px-6'>
				{group.label}
			</h2>
			{group.items.map(children)}
		</section>
	));
}

function ItemSummary({
	item,
	variant,
	isSelected,
	onSelect,
	onToggleRead,
}: {
	item: AutomationFeedItem;
	variant: 'stacked' | 'inline';
	isSelected: boolean;
	onSelect: () => void;
	onToggleRead: () => void;
}) {
	const { avatar, title, preview, chart } = getItemSummary(item);
	const isUnread = isFeedItemUnread(item);
	const startedAt = new Date(item.startedAt);
	const timeAgo = useTimeAgo(startedAt.getTime());
	const time = (
		<time
			className='shrink-0 text-xs text-muted-foreground tabular-nums group-hover:invisible'
			title={startedAt.toLocaleString()}
		>
			{timeAgo.humanReadable}
		</time>
	);
	const thumbnail = chart && <ChartThumbnail chart={chart} />;
	const titleClassName = cn('truncate text-sm', isUnread ? 'font-semibold text-foreground' : 'text-foreground/80');
	const previewClassName = 'min-w-0 flex-1 truncate text-sm text-muted-foreground [&_p]:inline';

	return (
		<div
			data-feed-item={item.id}
			className={cn('group relative border-b transition-colors', isSelected ? 'bg-accent' : 'hover:bg-accent/50')}
		>
			<button
				type='button'
				onClick={onSelect}
				aria-current={isSelected}
				className={cn(
					'flex w-full cursor-pointer items-center gap-3 px-4 text-left md:px-6',
					variant === 'stacked' ? 'py-3' : 'py-2.5',
				)}
			>
				<span
					className={cn(
						'absolute left-1.5 size-1.5 rounded-full md:left-2.5',
						isUnread ? 'bg-primary' : 'bg-transparent',
					)}
				/>
				{avatar}
				{variant === 'stacked' ? (
					<div className='flex min-w-0 flex-1 flex-col gap-0.5'>
						<div className='flex items-center justify-between gap-3'>
							<span className={titleClassName}>{title}</span>
							{time}
						</div>
						<div className='flex items-center gap-3'>
							<div className={previewClassName}>{preview}</div>
							{thumbnail}
						</div>
					</div>
				) : (
					<div className='flex min-w-0 flex-1 items-center gap-4'>
						<span className={cn(titleClassName, 'w-40 shrink-0 md:w-64')}>{title}</span>
						<div className={previewClassName}>{preview}</div>
						{thumbnail}
						{time}
					</div>
				)}
			</button>
			<div
				className={cn(
					'absolute right-3 hidden group-hover:flex md:right-5',
					variant === 'stacked' ? 'top-2' : 'top-1/2 -translate-y-1/2',
				)}
			>
				<ReadToggleButton isUnread={isUnread} onToggle={onToggleRead} />
			</div>
		</div>
	);
}

function ReadToggleButton({ isUnread, onToggle }: { isUnread: boolean; onToggle: () => void }) {
	const label = isUnread ? 'Mark as read' : 'Mark as unread';
	return (
		<SimpleTooltip content={`${label} (U)`}>
			<Button
				variant='ghost'
				size='icon'
				aria-label={label}
				onClick={onToggle}
				className='size-7 rounded-full text-muted-foreground hover:bg-background hover:text-foreground'
			>
				{isUnread ? <MailOpen className='size-3.5' /> : <Mail className='size-3.5' />}
			</Button>
		</SimpleTooltip>
	);
}

function ItemAvatar({
	actorName,
	Icon,
	tone,
	label,
}: {
	actorName: string | null;
	Icon: ComponentType<{ className?: string }>;
	tone?: FeedIconTone;
	label: string;
}) {
	if (!actorName) {
		return <FeedIcon Icon={Icon} tone={tone} label={label} />;
	}
	return (
		<span role='img' aria-label={label} className='relative shrink-0'>
			<Avatar username={actorName} className='size-7 text-[10px] leading-none' />
			<span
				className={cn(
					'absolute -right-1.5 -bottom-1 flex size-3.5 items-center justify-center rounded-full bg-background ring-1 ring-border',
					tone === 'destructive' ? 'text-destructive' : 'text-muted-foreground',
				)}
			>
				<Icon className='size-2' />
			</span>
		</span>
	);
}

function ChartThumbnail({ chart }: { chart: AutomationFeedChart }) {
	const values = getThumbnailValues(chart);
	if (values.length < 2) {
		return null;
	}
	const max = Math.max(...values);
	const min = Math.min(0, ...values);
	const toY = (value: number) => THUMBNAIL_HEIGHT - ((value - min) / (max - min || 1)) * THUMBNAIL_HEIGHT;
	const step = THUMBNAIL_WIDTH / values.length;
	const isLine = chart.config.chart_type === 'line' || chart.config.chart_type === 'area';

	return (
		<svg
			aria-hidden
			viewBox={`0 0 ${THUMBNAIL_WIDTH} ${THUMBNAIL_HEIGHT}`}
			className='h-4 w-12 shrink-0 overflow-visible text-chart-1/60'
		>
			{isLine ? (
				<polyline
					points={values.map((value, index) => `${index * step + step / 2},${toY(value)}`).join(' ')}
					fill='none'
					stroke='currentColor'
					strokeWidth={1.5}
					strokeLinejoin='round'
					strokeLinecap='round'
				/>
			) : (
				values.map((value, index) => (
					<rect
						key={index}
						x={index * step + step * 0.15}
						y={toY(value)}
						width={step * 0.7}
						height={THUMBNAIL_HEIGHT - toY(value)}
						rx={1}
						fill='currentColor'
					/>
				))
			)}
		</svg>
	);
}

const THUMBNAIL_WIDTH = 56;
const THUMBNAIL_HEIGHT = 20;

function getThumbnailValues(chart: AutomationFeedChart): number[] {
	const dataKey = chart.config.series[0]?.data_key;
	if (!dataKey || chart.config.chart_type === 'pie' || chart.config.chart_type === 'kpi_card') {
		return [];
	}
	return (chart.data as Record<string, unknown>[])
		.map((row) => Number(row[dataKey]))
		.filter(Number.isFinite)
		.slice(-24);
}

function ItemDetail({
	item,
	actions,
	hideHeader = false,
}: {
	item: AutomationFeedItem;
	actions: FeedActions;
	hideHeader?: boolean;
}) {
	if (item.kind === 'notification') {
		return <NotificationDetail item={item} onOpen={actions.onOpenNotification} hideHeader={hideHeader} />;
	}
	return (
		<AutomationRunDetail
			item={item}
			hideHeader={hideHeader}
			isCancelling={actions.cancellingRunId === item.run.id}
			onCancel={actions.onCancelRun ? () => actions.onCancelRun?.(item.run.id) : undefined}
		/>
	);
}

function NotificationDetail({
	item,
	onOpen,
	hideHeader,
}: {
	item: NotificationFeedItem;
	onOpen?: (notificationId: string, linkUrl: string | null) => void;
	hideHeader: boolean;
}) {
	const { notification } = item;
	const open = () => onOpen?.(notification.id, notification.linkUrl);
	const { Icon, tone, title, description, preview } = getNotificationPresentation(notification, open);

	return (
		<article className='flex flex-col gap-4'>
			{!hideHeader && (
				<DetailHeader
					icon={<FeedIcon Icon={Icon} tone={tone} label={getCategoryLabel(notification.category)} />}
					title={title}
					startedAt={new Date(item.startedAt)}
				/>
			)}
			<div className='text-sm text-muted-foreground'>{description}</div>
			{preview}
			{notification.linkUrl && (
				<Button variant='outline' size='sm' className='self-start' onClick={open}>
					{getOpenLabel(notification.linkUrl)}
					<ArrowUpRight className='size-3.5' />
				</Button>
			)}
		</article>
	);
}

function AutomationRunDetail({
	item,
	hideHeader,
	isCancelling,
	onCancel,
}: {
	item: AutomationFeedAutomationItem;
	hideHeader: boolean;
	isCancelling: boolean;
	onCancel?: () => void;
}) {
	const { run, automation, output } = item;
	const isRunning = run.status === 'running';
	const hasBody = !isRunning || Boolean(output.text || output.charts.length > 0 || run.errorMessage);

	return (
		<article className='flex flex-col gap-4'>
			{!hideHeader && (
				<DetailHeader
					icon={getRunIcon(item)}
					title={
						<Link
							to='/automations/$automationId'
							params={{ automationId: automation.id }}
							className='hover:underline'
						>
							{automation.title}
						</Link>
					}
					startedAt={new Date(run.startedAt)}
				/>
			)}
			<RunMeta item={item} isCancelling={isCancelling} onCancel={onCancel} />
			{hasBody && <RunBody output={output} errorMessage={run.errorMessage} />}
		</article>
	);
}

function DetailHeader({ icon, title, startedAt }: { icon: ReactNode; title: ReactNode; startedAt: Date }) {
	return (
		<header className='flex items-start gap-3'>
			{icon}
			<div className='flex min-w-0 flex-col'>
				<h2 className='text-lg leading-7 font-semibold tracking-tight'>{title}</h2>
				<time className='text-xs text-muted-foreground'>
					{startedAt.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}
				</time>
			</div>
		</header>
	);
}

function FeedIcon({
	Icon,
	tone = 'default',
	label,
	spinning = false,
}: {
	Icon: ComponentType<{ className?: string }>;
	tone?: FeedIconTone;
	label: string;
	spinning?: boolean;
}) {
	return (
		<span
			role='img'
			aria-label={label}
			title={label}
			className={cn(
				'flex size-7 shrink-0 items-center justify-center rounded-full',
				FEED_ICON_TONE_CLASSES[tone],
			)}
		>
			<Icon className={cn('size-3.5', spinning && 'animate-spin')} />
		</span>
	);
}

function getItemSummary(item: AutomationFeedItem): {
	avatar: ReactNode;
	title: string;
	preview: ReactNode;
	chart: AutomationFeedChart | null;
} {
	if (item.kind === 'automation') {
		return {
			avatar: getRunIcon(item),
			title: item.automation.title,
			preview: getRunPreview(item),
			chart: item.output.charts[0] ?? null,
		};
	}
	const { notification } = item;
	const { Icon, tone, title, description } = getNotificationPresentation(notification);
	return {
		avatar: (
			<ItemAvatar
				actorName={notification.category === 'story_refresh' ? null : getFeedItemActor(item)}
				Icon={Icon}
				tone={tone}
				label={getCategoryLabel(notification.category)}
			/>
		),
		title,
		preview: description,
		chart: null,
	};
}

function getRunIcon(item: AutomationFeedAutomationItem): ReactNode {
	const isRunning = item.run.status === 'running';
	return (
		<FeedIcon
			Icon={isRunning ? Loader2 : BotIcon}
			spinning={isRunning}
			tone={RUN_STATUS_ICON_TONES[item.run.status]}
			label='Automation'
		/>
	);
}

function getRunPreview({ run, output }: AutomationFeedAutomationItem): string {
	if (run.status === 'running') {
		return 'Running…';
	}
	if (run.status === 'failed') {
		return run.errorMessage ? `Failed · ${run.errorMessage}` : 'Failed';
	}
	if (output.text) {
		return toPlainText(stripAssistantTags(output.text));
	}
	if (output.charts.length > 0) {
		return output.charts.map((chart) => chart.config.title).join(' · ');
	}
	return run.status === 'cancelled' ? 'Cancelled' : 'No output produced.';
}

function toPlainText(markdown: string): string {
	return markdown
		.split('\n')
		.map((line) =>
			line
				.replace(/^\s*([-+]|\d+\.)\s+/, '')
				.replace(/[#*_`>]/g, '')
				.trim(),
		)
		.filter(Boolean)
		.join(' · ');
}

function getCategoryLabel(category: NotificationCategory): string {
	return NOTIFICATION_CATEGORY_LABELS[category] ?? 'Notification';
}

function getOpenLabel(linkUrl: string): string {
	return linkUrl.startsWith('/stories') ? 'Open story' : 'Open';
}

function markRead(item: AutomationFeedItem, actions: FeedActions) {
	if (isFeedItemUnread(item)) {
		actions.onSetRead?.(item, true);
	}
}

const RUN_STATUS_ICON_TONES: Record<AutomationFeedRunStatus, FeedIconTone> = {
	running: 'default',
	completed: 'default',
	failed: 'destructive',
	cancelled: 'muted',
};

function RunMeta({
	item,
	isCancelling,
	onCancel,
}: {
	item: AutomationFeedAutomationItem;
	isCancelling: boolean;
	onCancel?: () => void;
}) {
	const { run, automation } = item;
	const parts: ReactNode[] = [];

	if (automation.scheduleDescription) {
		parts.push(automation.scheduleDescription);
	}
	parts.push(<RunStatus status={run.status} integrationResults={run.integrationResults} />);
	if (run.integrationResults.length > 0) {
		parts.push(<IntegrationResultIcons results={run.integrationResults} />);
	}
	if (run.chatId) {
		parts.push(
			<Link
				to='/$chatId'
				params={{ chatId: run.chatId }}
				className='inline-flex items-center gap-1 hover:text-foreground'
			>
				<MessageSquare className='size-3' />
				Open chat
			</Link>,
		);
	}
	if (run.status === 'running' && onCancel) {
		parts.push(
			<button
				type='button'
				disabled={isCancelling}
				onClick={onCancel}
				className='cursor-pointer hover:text-destructive disabled:cursor-default disabled:opacity-60'
			>
				{isCancelling ? 'Cancelling…' : 'Cancel'}
			</button>,
		);
	}

	return (
		<div className='flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground'>
			{parts.map((part, index) => (
				<span key={index} className='inline-flex items-center gap-2'>
					{index > 0 && <span aria-hidden>·</span>}
					{part}
				</span>
			))}
		</div>
	);
}

function RunStatus({
	status,
	integrationResults,
}: {
	status: AutomationFeedRunStatus;
	integrationResults: AutomationFeedIntegrationResult[];
}) {
	if (status === 'failed') {
		return <span className='font-medium text-destructive'>Failed</span>;
	}
	if (status === 'cancelled') {
		return <span>Cancelled</span>;
	}
	if (status === 'running') {
		return <span className='text-foreground'>Running…</span>;
	}
	if (integrationResults.some((result) => !result.ok)) {
		return <span className='text-amber-600 dark:text-amber-400'>Completed with errors</span>;
	}
	return <span>Completed</span>;
}

type FeedDayGroup = { label: string; items: AutomationFeedItem[] };

function groupItemsByDay(items: AutomationFeedItem[]): FeedDayGroup[] {
	const groups: FeedDayGroup[] = [];
	const today = new Date();
	for (const item of items) {
		const label = getDayLabel(new Date(item.startedAt), today);
		const lastGroup = groups.at(-1);
		if (lastGroup?.label === label) {
			lastGroup.items.push(item);
		} else {
			groups.push({ label, items: [item] });
		}
	}
	return groups;
}

function getDayLabel(date: Date, today: Date): string {
	const daysAgo = Math.round((startOfDay(today) - startOfDay(date)) / 86_400_000);
	if (daysAgo <= 0) {
		return 'Today';
	}
	if (daysAgo === 1) {
		return 'Yesterday';
	}
	if (daysAgo < 7) {
		return 'Last 7 days';
	}
	const isSameYear = date.getFullYear() === today.getFullYear();
	return date.toLocaleDateString(undefined, { month: 'long', year: isSameYear ? undefined : 'numeric' });
}

function startOfDay(date: Date): number {
	return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

type NotificationPresentation = {
	Icon: ComponentType<{ className?: string }>;
	tone?: FeedIconTone;
	title: string;
	description: ReactNode;
	preview?: ReactNode;
};

const NOTIFICATION_CATEGORY_ICONS: Record<NotificationCategory, ComponentType<{ className?: string }>> = {
	budget: Wallet,
	feedback: ThumbsDown,
	story_refresh: RefreshCw,
	shared: Share2,
	subscription: BellPlus,
	test_run: FlaskConical,
};

function getNotificationPresentation(
	notification: NotificationFeedItem['notification'],
	onOpen?: () => void,
): NotificationPresentation {
	const Icon = NOTIFICATION_CATEGORY_ICONS[notification.category] ?? Bell;

	if (notification.category === 'feedback') {
		const payload = notification.payload as FeedbackNotificationPayload | null;
		if (payload?.kind === 'feedback') {
			const isPositive = payload.vote === 'up';
			return {
				Icon: isPositive ? ThumbsUp : ThumbsDown,
				title: payload.storyTitle ?? payload.chatTitle ?? notification.title,
				description: (
					<p>
						<span className='font-medium text-foreground'>{payload.submitterName}</span> left{' '}
						{isPositive ? 'positive' : 'negative'} feedback
						{payload.explanation ? <>: “{payload.explanation}”</> : '.'}
					</p>
				),
			};
		}
	}

	if (notification.category === 'story_refresh') {
		const payload = notification.payload as StoryRefreshNotificationPayload | null;
		if (payload?.kind === 'story_refresh' && payload.status === 'failed') {
			return {
				Icon,
				tone: 'destructive',
				title: payload.storyTitle ?? notification.title,
				description: <p className='text-destructive'>{notification.body ?? 'Refresh failed.'}</p>,
			};
		}
		if (payload?.kind === 'story_refresh' && payload.status === 'refreshed') {
			return {
				Icon,
				title: payload.storyTitle ?? notification.title,
				description: payload.ownerName ? (
					<p>
						<span className='font-medium text-foreground'>{payload.ownerName}</span> · {notification.body}
					</p>
				) : (
					notification.body
				),
			};
		}
	}

	if (notification.category === 'subscription') {
		const payload = notification.payload as StorySubscriptionNotificationPayload | null;
		if (payload?.kind === 'story_subscription') {
			return {
				Icon,
				title: payload.storyTitle,
				description: (
					<p>
						<span className='font-medium text-foreground'>{payload.ownerName}</span> subscribed you to the
						scheduled delivery for this story.
					</p>
				),
				preview: <StoryPreview storyId={payload.storyId} onOpen={notification.linkUrl ? onOpen : undefined} />,
			};
		}
	}

	if (notification.category === 'shared') {
		const payload = notification.payload as SharedNotificationPayload | StoryTransferNotificationPayload | null;
		if (payload?.kind === 'story_transfer') {
			return {
				Icon: ArrowRightLeft,
				title: payload.storyTitle ?? notification.title,
				description: <StoryTransferSentence payload={payload} />,
			};
		}
		if (payload?.kind === 'shared') {
			return {
				Icon,
				title: payload.itemTitle,
				description: (
					<ShareSentence
						subjectLabel={payload.itemLabel}
						actorName={payload.sharerName}
						visibility={payload.visibility}
						role={payload.role}
						isRoleChange={payload.isRoleChange}
					/>
				),
			};
		}
	}

	return {
		Icon,
		title: notification.title,
		description: notification.body,
	};
}

function StoryTransferSentence({ payload }: { payload: StoryTransferNotificationPayload }) {
	const sender = <span className='font-medium text-foreground'>{payload.senderName}</span>;
	if (payload.storyId) {
		return <p>{sender} made you the owner of this story.</p>;
	}
	const previousOwner = payload.previousOwnerName ? (
		<>
			{' '}
			from <span className='font-medium text-foreground'>{payload.previousOwnerName}</span>
		</>
	) : null;
	return (
		<p>
			{sender} made you the owner of {payload.storyCount} stories{previousOwner}.
		</p>
	);
}

function StoryPreview({ storyId, onOpen }: { storyId: string; onOpen?: () => void }) {
	const [tooltipOpen, setTooltipOpen] = useState(false);
	const [cursor, setCursor] = useState({ x: 0, y: 0 });
	const { data, isLoading } = useQuery(trpc.storyShare.get.queryOptions({ storyId }));

	const segments = useMemo(() => (data ? splitCodeIntoSegments(data.code) : []), [data]);
	const queryData = (data?.queryData ?? null) as QueryDataMap | null;

	const renderChart = useCallback(
		(chart: ParsedChartBlock) => <StoryChartEmbed chart={chart} queryData={queryData} />,
		[queryData],
	);
	const renderTable = useCallback(
		(table: ParsedTableBlock) => <StoryTableEmbed table={table} queryData={queryData} />,
		[queryData],
	);
	const renderMap = useCallback(
		(map: ParsedMapBlock) => <StoryMapEmbed map={map} queryData={queryData} />,
		[queryData],
	);

	if (isLoading) {
		return (
			<div className='flex h-24 items-center justify-center rounded-lg border text-muted-foreground'>
				<Loader2 className='size-4 animate-spin' />
			</div>
		);
	}

	if (!data || segments.length === 0) {
		return null;
	}

	const inner = (
		<>
			<SegmentList
				segments={segments}
				renderChart={renderChart}
				renderTable={renderTable}
				renderMap={renderMap}
			/>
			<div className='absolute inset-x-0 bottom-0 h-10 bg-gradient-to-t from-background to-transparent' />
		</>
	);

	return (
		<>
			{onOpen ? (
				<>
					<button
						type='button'
						onClick={onOpen}
						onMouseEnter={(e) => {
							setCursor({ x: e.clientX, y: e.clientY });
							setTooltipOpen(true);
						}}
						onMouseMove={(e) => setCursor({ x: e.clientX, y: e.clientY })}
						onMouseLeave={() => setTooltipOpen(false)}
						className='relative block w-full max-h-60 cursor-pointer overflow-hidden rounded-lg border bg-background px-4 py-3 text-left text-sm transition-colors hover:bg-accent/50'
					>
						<div className='pointer-events-none'>{inner}</div>
					</button>
					{tooltipOpen && (
						<div
							role='tooltip'
							className='pointer-events-none fixed z-50 -translate-x-1/2 -translate-y-full rounded-lg border bg-popover px-2 py-1 text-xs text-popover-foreground shadow-lg'
							style={{ left: cursor.x, top: cursor.y - 12 }}
						>
							Open story
						</div>
					)}
				</>
			) : (
				<div className='pointer-events-none relative max-h-60 overflow-hidden rounded-lg border bg-background px-4 py-3 text-sm'>
					{inner}
				</div>
			)}
		</>
	);
}

function ShareSentence({
	subjectLabel,
	actorName,
	visibility,
	role,
	isRoleChange = false,
}: {
	subjectLabel: 'story' | 'chat';
	actorName: string | null;
	visibility: ShareVisibility;
	role?: ShareRole;
	isRoleChange?: boolean;
}) {
	const actor = <span className='font-medium text-foreground'>{actorName ?? 'Someone'}</span>;
	if (isRoleChange && role === 'viewer') {
		return (
			<p>
				{actor} changed your access to this {subjectLabel} to{' '}
				<span className='font-medium text-foreground'>view only</span>.
			</p>
		);
	}
	if (isRoleChange) {
		return (
			<p>
				{actor} gave you <span className='font-medium text-foreground'>edit rights</span> on this {subjectLabel}
				.
			</p>
		);
	}
	const target = visibility === 'project' ? 'the project' : 'you';
	return (
		<p>
			{actor} shared this {subjectLabel} with <span className='font-medium text-foreground'>{target}</span>
			{role === 'editor' && ', with edit rights'}.
		</p>
	);
}

function RunBody({
	output,
	errorMessage,
}: {
	output: AutomationFeedAutomationItem['output'];
	errorMessage?: string | null;
}) {
	if (!output.text && output.charts.length === 0 && !errorMessage) {
		return <p className='text-sm text-muted-foreground'>No output produced.</p>;
	}

	return (
		<div className='flex flex-col gap-5'>
			{errorMessage && (
				<p className='rounded-md border border-destructive/20 bg-destructive/5 px-3 py-2 font-mono text-xs text-destructive'>
					{errorMessage}
				</p>
			)}
			{output.charts.length > 0 && <ChartSlideshow charts={output.charts} />}
			{output.text && (
				<div className='markdown-small text-sm leading-relaxed'>
					<Streamdown linkSafety={markdownLinkSafety}>{stripAssistantTags(output.text)}</Streamdown>
				</div>
			)}
		</div>
	);
}

function ChartSlideshow({ charts }: { charts: AutomationFeedChart[] }) {
	const [isHidden, setIsHidden] = useLocalStorage(chartsHiddenStorage);
	const [index, setIndex] = useState(0);
	const safeIndex = Math.min(index, charts.length - 1);
	const current = charts[safeIndex];
	const title = current.config.chart_type === 'kpi_card' ? null : current.config.title;

	const goPrev = () => setIndex((value) => (value - 1 + charts.length) % charts.length);
	const goNext = () => setIndex((value) => (value + 1) % charts.length);

	if (isHidden) {
		return (
			<button
				type='button'
				onClick={() => setIsHidden(false)}
				className='flex cursor-pointer items-center gap-2 self-start rounded-md border px-2.5 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground'
			>
				<ChartColumn className='size-3.5' />
				Show {charts.length === 1 ? 'chart' : `${charts.length} charts`}
			</button>
		);
	}

	return (
		<div className='flex flex-col gap-3 rounded-lg border p-4'>
			<div className='flex items-center justify-between gap-3'>
				<span className='truncate text-sm font-medium'>{title}</span>
				<div className='flex shrink-0 items-center gap-1 text-xs text-muted-foreground tabular-nums'>
					{charts.length > 1 && (
						<>
							<SlideNavButton direction='prev' onClick={goPrev} />
							<span>
								{safeIndex + 1} / {charts.length}
							</span>
							<SlideNavButton direction='next' onClick={goNext} />
						</>
					)}
					<SimpleTooltip content='Hide charts'>
						<Button
							variant='ghost'
							size='icon'
							onClick={() => setIsHidden(true)}
							aria-label='Hide charts'
							className='size-6 rounded-full'
						>
							<EyeOff className='size-3.5' />
						</Button>
					</SimpleTooltip>
				</div>
			</div>
			<ChartSlide key={current.toolCallId} chart={current} />
		</div>
	);
}

function ChartSlide({ chart }: { chart: AutomationFeedChart }) {
	const xAxisType = chart.config.x_axis_type === 'number' ? 'number' : 'category';
	const data = chart.data as Record<string, unknown>[];
	if (!isBuiltinChartType(chart.config.chart_type)) {
		return <div className='text-sm text-muted-foreground'>Custom charts are available in web chats only.</div>;
	}

	return (
		<ChartDisplay
			data={data}
			chartType={chart.config.chart_type}
			xAxisKey={chart.config.x_axis_key}
			xAxisType={xAxisType}
			xAxisLabel={chart.config.x_axis_label}
			series={chart.config.series}
			title={chart.config.title}
			yAxisMin={chart.config.y_axis_min}
			yAxisMax={chart.config.y_axis_max}
			yAxisLabel={chart.config.y_axis_label}
			yAxisRightMin={chart.config.y_axis_right_min}
			yAxisRightMax={chart.config.y_axis_right_max}
			yAxisRightLabel={chart.config.y_axis_right_label}
			showLegend={chart.config.show_legend}
			breakdownKey={chart.config.breakdown_key}
			breakdownLimit={chart.config.breakdown_limit}
			chartContentClassName='aspect-auto h-56'
		/>
	);
}

function SlideNavButton({ direction, onClick }: { direction: 'prev' | 'next'; onClick: () => void }) {
	const isPrev = direction === 'prev';
	return (
		<Button
			variant='ghost'
			size='icon'
			onClick={onClick}
			aria-label={isPrev ? 'Previous chart' : 'Next chart'}
			className='size-6 rounded-full'
		>
			{isPrev ? <ChevronLeft className='size-3.5' /> : <ChevronRight className='size-3.5' />}
		</Button>
	);
}

function IntegrationResultIcons({ results }: { results: AutomationFeedIntegrationResult[] }) {
	const distinct = getDistinctIntegrationResults(results);
	if (distinct.length === 0) {
		return null;
	}
	return (
		<div className='flex items-center gap-1'>
			{distinct.map((result) => (
				<IntegrationResultIcon key={result.type} result={result} />
			))}
		</div>
	);
}

function IntegrationResultIcon({ result }: { result: AutomationFeedIntegrationResult }) {
	const config = getIntegrationIconConfig(result.type);
	const content = (
		<span
			className={cn(
				'flex size-5 items-center justify-center rounded-full border bg-background transition-colors',
				result.ok ? config.successClassName : 'border-muted text-muted-foreground opacity-60 grayscale',
			)}
			aria-label={getIntegrationResultLabel(result, config.label)}
		>
			{config.icon}
		</span>
	);

	const trigger =
		result.ok && result.url ? (
			<a href={result.url} target='_blank' rel='noreferrer'>
				{content}
			</a>
		) : (
			content
		);

	return (
		<Tooltip delayDuration={150}>
			<TooltipTrigger asChild>{trigger}</TooltipTrigger>
			<TooltipContent>
				{result.ok ? `${config.label} sent successfully` : result.message || `${config.label} has failed`}
			</TooltipContent>
		</Tooltip>
	);
}

function getDistinctIntegrationResults(results: AutomationFeedIntegrationResult[]): AutomationFeedIntegrationResult[] {
	const byType = new Map<string, AutomationFeedIntegrationResult>();
	for (const result of results) {
		const current = byType.get(result.type);
		if (!current) {
			byType.set(result.type, result);
			continue;
		}
		byType.set(result.type, {
			type: current.type,
			label: current.label,
			ok: current.ok && result.ok,
			message: !current.ok ? current.message : !result.ok ? result.message : (current.message ?? result.message),
			url: current.url ?? result.url,
		});
	}
	return [...byType.values()];
}

function getIntegrationIconConfig(type: string): { label: string; icon: ReactNode; successClassName: string } {
	if (type === 'slack') {
		return {
			label: 'Slack',
			icon: <SlackIcon className='size-3' />,
			successClassName: 'border-transparent bg-white text-foreground',
		};
	}
	if (type === 'github') {
		return {
			label: 'GitHub',
			icon: <GithubIcon className='size-3' />,
			successClassName: 'border-transparent bg-foreground text-background',
		};
	}
	if (type === 'email') {
		return {
			label: 'Email',
			icon: <Mail className='size-3' />,
			successClassName: 'border-blue-200 bg-blue-50 text-blue-600',
		};
	}
	return {
		label: type,
		icon: <Mail className='size-3' />,
		successClassName: 'border-blue-200 bg-blue-50 text-blue-600',
	};
}

function getIntegrationResultLabel(result: AutomationFeedIntegrationResult, label: string) {
	return result.ok ? `${label} sent successfully` : `${label} has failed`;
}

function FeedSkeleton() {
	return (
		<div className='flex flex-col'>
			{[0, 1, 2, 3, 4].map((i) => (
				<div key={i} className='flex items-center gap-3 border-b px-4 py-3 md:px-6'>
					<div className='size-7 shrink-0 animate-pulse rounded-full bg-muted' />
					<div className='flex flex-1 flex-col gap-2'>
						<div className='h-3.5 w-1/4 animate-pulse rounded bg-muted' />
						<div className='h-3 w-2/3 animate-pulse rounded bg-muted' />
					</div>
				</div>
			))}
		</div>
	);
}

function FeedEmptyState({
	hasAutomations,
	canCreateAutomation,
}: {
	hasAutomations: boolean;
	canCreateAutomation: boolean;
}) {
	return (
		<div className='flex flex-1 flex-col items-center justify-center px-4 py-16 text-center'>
			<InboxIcon className='mb-3 size-6 text-muted-foreground' />
			<h2 className='text-sm font-medium'>{hasAutomations ? 'No runs yet' : 'No automations yet'}</h2>
			<p className='mt-1 text-sm text-muted-foreground'>
				{hasAutomations
					? 'Once your automations run or your live stories refresh, their output will show up here.'
					: canCreateAutomation
						? 'Create your first automation or refresh a live story to start seeing activity in your inbox.'
						: 'Automation and live Story activity will appear here.'}
			</p>
		</div>
	);
}
