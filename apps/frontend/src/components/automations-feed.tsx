import { Link } from '@tanstack/react-router';
import {
	Bell,
	BellPlus,
	ChevronLeft,
	ChevronRight,
	Github,
	Loader2,
	Mail,
	MessageSquare,
	RefreshCw,
	Share2,
	ThumbsDown,
	ThumbsUp,
	Timer,
	Wallet,
	X,
} from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { Fragment, useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Streamdown } from 'streamdown';
import { stripAssistantTags } from '@nao/shared';
import { splitCodeIntoSegments } from '@nao/shared/story-segments';
import { displayChart } from '@nao/shared/tools';
import { NOTIFICATION_CATEGORY_LABELS } from '@nao/shared/types';
import type { ParsedChartBlock, ParsedMapBlock, ParsedTableBlock } from '@nao/shared/story-segments';
import type {
	FeedbackNotificationPayload,
	NotificationCategory,
	SharedItemLabel,
	SharedNotificationPayload,
	StoryRefreshNotificationPayload,
	StorySubscriptionNotificationPayload,
} from '@nao/shared/types';
import type { ComponentType, ReactNode } from 'react';

import type { QueryDataMap } from '@/components/story-embeds';
import SlackIcon from '@/components/icons/slack.svg';
import { SegmentList } from '@/components/story-rendering';
import { StoryChartEmbed, StoryMapEmbed, StoryTableEmbed } from '@/components/story-embeds';
import { ChartDisplay } from '@/components/tool-calls/display-chart';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useTimeAgo } from '@/hooks/use-time-ago';
import { cn } from '@/lib/utils';
import { trpc } from '@/main';

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

const TEXT_CLAMP_LINES = 8;

export function AutomationsFeed({
	items,
	isLoading,
	hasAutomations,
	lastSeenAt = 0,
	onCancelRun,
	cancellingRunId,
	onOpenNotification,
	onOpenAutomation,
}: {
	items: AutomationFeedItem[];
	isLoading: boolean;
	hasAutomations: boolean;
	lastSeenAt?: number;
	onCancelRun?: (runId: string) => void;
	cancellingRunId?: string | null;
	onOpenNotification?: (notificationId: string, linkUrl: string | null) => void;
	onOpenAutomation?: (runId: string) => void;
}) {
	if (isLoading && items.length === 0) {
		return <FeedSkeleton />;
	}

	if (items.length === 0) {
		return <FeedEmptyState hasAutomations={hasAutomations} />;
	}

	const separatorIndex = findFirstSeenIndex(items, lastSeenAt);
	const showSeparator = lastSeenAt > 0 && separatorIndex > 0 && separatorIndex < items.length;

	return (
		<div className='flex flex-col gap-4'>
			{items.map((item, index) => (
				<Fragment key={item.id}>
					{showSeparator && index === separatorIndex && (
						<NewSinceLastVisitSeparator newCount={separatorIndex} />
					)}
					<FeedCard
						item={item}
						isNew={lastSeenAt > 0 && index < separatorIndex}
						onCancelRun={onCancelRun}
						isCancelling={item.kind === 'automation' && cancellingRunId === item.run.id}
						onOpenNotification={onOpenNotification}
						onOpenAutomation={onOpenAutomation}
					/>
				</Fragment>
			))}
		</div>
	);
}

function FeedCard(props: {
	item: AutomationFeedItem;
	isNew?: boolean;
	onCancelRun?: (runId: string) => void;
	isCancelling?: boolean;
	onOpenNotification?: (notificationId: string, linkUrl: string | null) => void;
	onOpenAutomation?: (runId: string) => void;
}) {
	if (props.item.kind === 'notification') {
		return <NotificationFeedCard item={props.item} isNew={props.isNew} onOpen={props.onOpenNotification} />;
	}
	return (
		<AutomationRunCard
			item={props.item}
			isNew={props.isNew}
			onCancelRun={props.onCancelRun}
			isCancelling={props.isCancelling}
			onOpen={props.onOpenAutomation}
		/>
	);
}

function NotificationFeedCard({
	item,
	isNew = false,
	onOpen,
}: {
	item: NotificationFeedItem;
	isNew?: boolean;
	onOpen?: (notificationId: string, linkUrl: string | null) => void;
}) {
	const { notification } = item;
	const startedAt = new Date(item.startedAt);
	const timeAgo = useTimeAgo(startedAt.getTime());
	const isUnread = !notification.readAt;
	const categoryLabel = NOTIFICATION_CATEGORY_LABELS[notification.category] ?? 'Notification';
	const sharedItemLabel = getSharedItemLabel(notification);
	const feedbackVote = getFeedbackVote(notification);
	const { Icon, title, description, preview } = getNotificationPresentation(notification, () =>
		onOpen?.(notification.id, notification.linkUrl),
	);

	return (
		<article
			className={cn(
				'relative rounded-xl border bg-background/60 shadow-xs transition-colors',
				(isNew || isUnread) && 'border-primary/30 bg-primary/[0.02]',
			)}
		>
			{(isNew || isUnread) && (
				<span aria-hidden className='absolute -left-1.5 top-4 h-6 w-1 rounded-full bg-primary' />
			)}
			<header
				className={cn('flex items-center justify-between gap-3 px-4 pt-4', !description && !preview && 'pb-4')}
			>
				<div className='flex min-w-0 items-center gap-2'>
					<Icon className='size-3.5 shrink-0 text-muted-foreground' aria-hidden />
					{notification.linkUrl ? (
						<button
							type='button'
							onClick={() => onOpen?.(notification.id, notification.linkUrl)}
							className='truncate text-left text-sm font-semibold hover:underline cursor-pointer'
						>
							{title}
						</button>
					) : (
						<span className='truncate text-sm font-semibold'>{title}</span>
					)}
					<span className='text-muted-foreground/60 shrink-0 text-xs' title={startedAt.toLocaleString()}>
						· {timeAgo.humanReadable}
					</span>
				</div>
				{sharedItemLabel ? (
					<SharedObjectBadge itemLabel={sharedItemLabel} />
				) : feedbackVote ? (
					<Badge variant='secondary' className='shrink-0'>
						Feedback {feedbackVote === 'up' ? 'positive' : 'negative'}
					</Badge>
				) : (
					<Badge variant='secondary' className='shrink-0'>
						{categoryLabel}
					</Badge>
				)}
			</header>

			{description && (
				<div className={cn('px-4 pt-1 text-sm text-foreground/90', !preview && 'pb-4')}>{description}</div>
			)}
			{preview}
		</article>
	);
}

type NotificationPresentation = {
	Icon: ComponentType<{ className?: string }>;
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
				title: payload.chatTitle ?? notification.title,
				description: (
					<p>
						<span className='font-semibold'>{payload.submitterName}</span> left{' '}
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
				title: notification.title,
				description: <p className='text-destructive'>{notification.body ?? 'Refresh failed.'}</p>,
			};
		}
		if (payload?.kind === 'story_refresh' && payload.status === 'refreshed') {
			return {
				Icon,
				title: payload.storyTitle ?? notification.title,
				description: payload.ownerName ? (
					<p>
						<span className='font-semibold'>{payload.ownerName}</span> · {notification.body}
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
						<span className='font-semibold'>{payload.ownerName}</span> subscribed you to the scheduled
						delivery for this story.
					</p>
				),
				preview: <StoryPreview shareId={payload.shareId} onOpen={notification.linkUrl ? onOpen : undefined} />,
			};
		}
	}

	if (notification.category === 'shared') {
		const payload = notification.payload as SharedNotificationPayload | null;
		if (payload?.kind === 'shared') {
			return {
				Icon,
				title: payload.itemTitle,
				description: (
					<ShareSentence
						subjectLabel={payload.itemLabel}
						actorName={payload.sharerName}
						visibility={payload.visibility}
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

function getSharedItemLabel(notification: NotificationFeedItem['notification']): SharedItemLabel | null {
	if (notification.category !== 'shared') {
		return null;
	}
	const payload = notification.payload as SharedNotificationPayload | null;
	return payload?.kind === 'shared' ? payload.itemLabel : null;
}

function getFeedbackVote(
	notification: NotificationFeedItem['notification'],
): FeedbackNotificationPayload['vote'] | null {
	if (notification.category !== 'feedback') {
		return null;
	}
	const payload = notification.payload as FeedbackNotificationPayload | null;
	return payload?.kind === 'feedback' ? payload.vote : null;
}

function findFirstSeenIndex(items: AutomationFeedItem[], lastSeenAt: number): number {
	if (lastSeenAt <= 0) {
		return items.length;
	}
	for (let i = 0; i < items.length; i++) {
		if (new Date(items[i].startedAt).getTime() <= lastSeenAt) {
			return i;
		}
	}
	return items.length;
}

function NewSinceLastVisitSeparator({ newCount }: { newCount: number }) {
	return (
		<div className='flex items-center gap-3' role='separator' aria-label='New since your last visit'>
			<div className='h-px flex-1 bg-border' />
			<span className='text-xs font-medium text-muted-foreground whitespace-nowrap'>
				{newCount} new since your last visit
			</span>
			<div className='h-px flex-1 bg-border' />
		</div>
	);
}

function AutomationRunCard({
	item,
	isNew = false,
	onCancelRun,
	isCancelling = false,
	onOpen,
}: {
	item: AutomationFeedAutomationItem;
	isNew?: boolean;
	onCancelRun?: (runId: string) => void;
	isCancelling?: boolean;
	onOpen?: (runId: string) => void;
}) {
	const { run, automation, output } = item;
	const startedAt = new Date(run.startedAt);
	const timeAgo = useTimeAgo(startedAt.getTime());
	const isRunning = run.status === 'running';
	const isUnread = !run.readAt;

	return (
		<article
			className={cn(
				'relative rounded-xl border bg-background/60 shadow-xs transition-colors',
				(isNew || isUnread) && 'border-primary/30 bg-primary/[0.02]',
			)}
		>
			{(isNew || isUnread) && (
				<span aria-hidden className='absolute -left-1.5 top-4 h-6 w-1 rounded-full bg-primary' />
			)}
			<header className='flex items-center justify-between gap-3 px-4 pt-4'>
				<div className='flex min-w-0 items-center gap-2'>
					<Link
						to='/automations/$automationId'
						params={{ automationId: automation.id }}
						className='truncate text-sm font-semibold hover:underline'
						onClick={() => onOpen?.(run.id)}
					>
						{automation.title}
					</Link>
					<span className='text-muted-foreground/60 text-xs' title={startedAt.toLocaleString()}>
						· {timeAgo.humanReadable}
					</span>
				</div>
				<div className='flex shrink-0 items-center gap-1.5'>
					<IntegrationResultIcons results={run.integrationResults} />
					{isRunning && onCancelRun && (
						<Tooltip>
							<TooltipTrigger asChild>
								<Button
									variant='ghost'
									size='icon'
									className='size-7 text-muted-foreground hover:text-destructive rounded-full'
									disabled={isCancelling}
									onClick={() => onCancelRun(run.id)}
								>
									{isCancelling ? (
										<Loader2 className='size-3.5 animate-spin' />
									) : (
										<X className='size-3.5' />
									)}
								</Button>
							</TooltipTrigger>
							<TooltipContent>{isCancelling ? 'Cancelling…' : 'Cancel'}</TooltipContent>
						</Tooltip>
					)}
					{run.chatId && (
						<Tooltip>
							<TooltipTrigger asChild>
								<Button
									variant='ghost'
									size='icon'
									className='size-7 text-muted-foreground rounded-full'
									asChild
								>
									<Link
										to='/$chatId'
										params={{ chatId: run.chatId }}
										onClick={() => onOpen?.(run.id)}
									>
										<MessageSquare className='size-3.5' />
									</Link>
								</Button>
							</TooltipTrigger>
							<TooltipContent>Open chat</TooltipContent>
						</Tooltip>
					)}
					<RunStatusBadge status={run.status} integrationResults={run.integrationResults} />
				</div>
			</header>

			{automation.scheduleDescription && (
				<div className='px-4 pt-1 text-xs text-muted-foreground'>{automation.scheduleDescription}</div>
			)}

			<div className='px-4 py-4'>
				<RunBody output={output} isRunning={isRunning} errorMessage={run.errorMessage} />
			</div>
		</article>
	);
}

function StoryPreview({ shareId, onOpen }: { shareId: string | null; onOpen?: () => void }) {
	const [tooltipOpen, setTooltipOpen] = useState(false);
	const [cursor, setCursor] = useState({ x: 0, y: 0 });
	const { data, isLoading } = useQuery({
		...trpc.storyShare.get.queryOptions({ shareId: shareId ?? '' }),
		enabled: Boolean(shareId),
	});

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

	if (!shareId) {
		return null;
	}

	if (isLoading) {
		return (
			<div className='p-4'>
				<div className='flex h-24 items-center justify-center rounded-lg border bg-background text-muted-foreground'>
					<Loader2 className='size-4 animate-spin' />
				</div>
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
		<div className='p-4'>
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
						className='relative block w-full max-h-60 cursor-pointer overflow-hidden rounded-lg border bg-background px-3 py-2 text-left text-sm transition-colors hover:bg-accent/50'
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
				<div className='pointer-events-none relative max-h-60 overflow-hidden rounded-lg border bg-background px-3 py-2 text-sm'>
					{inner}
				</div>
			)}
		</div>
	);
}

function ShareSentence({
	subjectLabel,
	actorName,
	visibility,
}: {
	subjectLabel: 'story' | 'chat';
	actorName: string | null;
	visibility: ShareVisibility;
}) {
	const actor = actorName ?? 'Someone';
	const target = visibility === 'project' ? 'the project' : 'you';
	return (
		<p>
			<span className='font-semibold'>{actor}</span> shared this {subjectLabel} with{' '}
			<span className='font-semibold'>{target}</span>.
		</p>
	);
}

function SharedObjectBadge({ itemLabel }: { itemLabel: SharedItemLabel }) {
	return (
		<Badge variant='secondary' className='shrink-0'>
			{itemLabel === 'story' ? 'Story shared' : 'Chat shared'}
		</Badge>
	);
}

function RunStatusBadge({
	status,
	integrationResults,
}: {
	status: AutomationFeedRunStatus;
	integrationResults: AutomationFeedIntegrationResult[];
}) {
	if (status === 'failed') {
		return (
			<Badge variant='destructive' className='shrink-0'>
				Failed
			</Badge>
		);
	}
	if (status === 'cancelled') {
		return (
			<Badge variant='outline' className='shrink-0 text-muted-foreground'>
				Cancelled
			</Badge>
		);
	}
	if (status === 'running') {
		return (
			<Badge variant='secondary' className='shrink-0 animate-pulse'>
				Running
			</Badge>
		);
	}
	if (integrationResults.some((result) => !result.ok)) {
		return (
			<Badge
				variant='secondary'
				className='shrink-0 border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400'
			>
				Completed with errors
			</Badge>
		);
	}
	return (
		<Badge variant='secondary' className='shrink-0'>
			Completed
		</Badge>
	);
}

function RunBody({
	output,
	isRunning,
	errorMessage,
}: {
	output: AutomationFeedAutomationItem['output'];
	isRunning: boolean;
	errorMessage?: string | null;
}) {
	const hasText = Boolean(output.text);
	const hasCharts = output.charts.length > 0;

	if (!hasText && !hasCharts && !errorMessage) {
		return (
			<p className='text-sm text-muted-foreground italic'>
				{isRunning ? 'Run in progress…' : 'No output produced.'}
			</p>
		);
	}

	return (
		<div className='flex flex-col gap-3'>
			{output.text && <ExpandableText text={output.text} />}
			{hasCharts && <ChartSlideshow charts={output.charts} />}
			{errorMessage && (
				<p className='rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive'>{errorMessage}</p>
			)}
		</div>
	);
}

function ExpandableText({ text }: { text: string }) {
	const [isExpanded, setIsExpanded] = useState(false);
	const [isClamped, setIsClamped] = useState(false);
	const contentRef = useRef<HTMLDivElement>(null);

	useLayoutEffect(() => {
		const node = contentRef.current;
		if (!node) {
			return;
		}
		const measure = () => {
			setIsClamped(node.scrollHeight - node.clientHeight > 1);
		};
		measure();
		const observer = new ResizeObserver(measure);
		observer.observe(node);
		return () => observer.disconnect();
	}, [text]);

	return (
		<div className='flex flex-col gap-1'>
			<div
				ref={contentRef}
				className={cn(
					'markdown-small text-sm leading-relaxed text-foreground/90',
					!isExpanded && 'overflow-hidden',
				)}
				style={
					!isExpanded
						? { display: '-webkit-box', WebkitLineClamp: TEXT_CLAMP_LINES, WebkitBoxOrient: 'vertical' }
						: undefined
				}
			>
				<Streamdown>{stripAssistantTags(text)}</Streamdown>
			</div>
			{(isClamped || isExpanded) && (
				<button
					type='button'
					onClick={() => setIsExpanded((value) => !value)}
					className='self-start text-xs font-medium text-muted-foreground hover:text-foreground'
				>
					{isExpanded ? 'Show less' : 'Show more'}
				</button>
			)}
		</div>
	);
}

function ChartSlideshow({ charts }: { charts: AutomationFeedChart[] }) {
	const [index, setIndex] = useState(0);
	const safeIndex = Math.min(index, charts.length - 1);
	const current = charts[safeIndex];
	const hasMultiple = charts.length > 1;

	const goPrev = () => setIndex((value) => (value - 1 + charts.length) % charts.length);
	const goNext = () => setIndex((value) => (value + 1) % charts.length);

	return (
		<div className='flex flex-col gap-2 rounded-lg border bg-muted/30 p-3'>
			<div className='relative'>
				<ChartSlide key={current.toolCallId} chart={current} />
				{hasMultiple && (
					<>
						<SlideNavButton direction='prev' onClick={goPrev} />
						<SlideNavButton direction='next' onClick={goNext} />
					</>
				)}
			</div>
			{hasMultiple && (
				<div className='flex items-center justify-center gap-1.5 pt-1'>
					{charts.map((chart, i) => (
						<button
							key={chart.toolCallId}
							type='button'
							onClick={() => setIndex(i)}
							aria-label={`Show chart ${i + 1}`}
							className={cn(
								'size-1.5 rounded-full transition-colors',
								i === safeIndex
									? 'bg-foreground'
									: 'bg-muted-foreground/30 hover:bg-muted-foreground/60',
							)}
						/>
					))}
				</div>
			)}
		</div>
	);
}

function ChartSlide({ chart }: { chart: AutomationFeedChart }) {
	const xAxisType = chart.config.x_axis_type === 'number' ? 'number' : 'category';
	const data = chart.data as Record<string, unknown>[];
	if (!displayChart.isBuiltinChartType(chart.config.chart_type)) {
		return <div className='text-sm text-muted-foreground'>Custom charts are available in web chats only.</div>;
	}

	return (
		<div className='flex w-full flex-col gap-1.5'>
			{chart.config.chart_type !== 'kpi_card' && chart.config.title && (
				<span className='text-sm font-medium text-foreground'>{chart.config.title}</span>
			)}
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
			/>
		</div>
	);
}

function SlideNavButton({ direction, onClick }: { direction: 'prev' | 'next'; onClick: () => void }) {
	const isPrev = direction === 'prev';
	return (
		<button
			type='button'
			onClick={onClick}
			aria-label={isPrev ? 'Previous chart' : 'Next chart'}
			className={cn(
				'absolute top-1/2 z-10 flex size-7 -translate-y-1/2 items-center justify-center rounded-full border bg-background/90 shadow-sm transition-colors hover:bg-background',
				isPrev ? 'left-2' : 'right-2',
			)}
		>
			{isPrev ? <ChevronLeft className='size-4' /> : <ChevronRight className='size-4' />}
		</button>
	);
}

function IntegrationResultIcons({ results }: { results: AutomationFeedIntegrationResult[] }) {
	const distinct = getDistinctIntegrationResults(results);
	if (distinct.length === 0) {
		return null;
	}
	return (
		<div className='flex flex-wrap gap-1.5'>
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
				'flex size-6 items-center justify-center rounded-full border bg-background shadow-xs transition-colors',
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
			icon: <SlackIcon className='size-3.5' />,
			successClassName: 'border-transparent bg-white text-foreground',
		};
	}
	if (type === 'github') {
		return {
			label: 'GitHub',
			icon: <Github className='size-3.5' />,
			successClassName: 'border-transparent bg-foreground text-background',
		};
	}
	if (type === 'email') {
		return {
			label: 'Email',
			icon: <Mail className='size-3.5' />,
			successClassName: 'border-blue-200 bg-blue-50 text-blue-600',
		};
	}
	return {
		label: type,
		icon: <Mail className='size-3.5' />,
		successClassName: 'border-blue-200 bg-blue-50 text-blue-600',
	};
}

function getIntegrationResultLabel(result: AutomationFeedIntegrationResult, label: string) {
	return result.ok ? `${label} sent successfully` : `${label} has failed`;
}

function FeedSkeleton() {
	return (
		<div className='flex flex-col gap-4'>
			{[0, 1, 2].map((i) => (
				<div key={i} className='rounded-xl border bg-background/60 p-4 shadow-xs'>
					<div className='h-4 w-1/3 animate-pulse rounded bg-muted' />
					<div className='mt-3 h-3 w-full animate-pulse rounded bg-muted' />
					<div className='mt-2 h-3 w-5/6 animate-pulse rounded bg-muted' />
					<div className='mt-2 h-3 w-4/6 animate-pulse rounded bg-muted' />
				</div>
			))}
		</div>
	);
}

function FeedEmptyState({ hasAutomations }: { hasAutomations: boolean }) {
	return (
		<div className='flex flex-col items-center justify-center rounded-xl border border-dashed bg-background/40 p-10 text-center'>
			<Timer className='size-8 text-muted-foreground mb-3' />
			<h2 className='font-medium'>{hasAutomations ? 'No runs yet' : 'No automations yet'}</h2>
			<p className='mt-1 text-sm text-muted-foreground'>
				{hasAutomations
					? 'Once your automations run or your live stories refresh, their output will show up here.'
					: 'Create your first automation or refresh a live story to start seeing activity in this feed.'}
			</p>
		</div>
	);
}
