import { Link } from '@tanstack/react-router';
import {
	ChevronLeft,
	ChevronRight,
	ExternalLink,
	Github,
	Loader2,
	Mail,
	MessageSquare,
	RefreshCw,
	Share2,
	Timer,
	X,
} from 'lucide-react';
import { Fragment, useLayoutEffect, useRef, useState } from 'react';
import { Streamdown } from 'streamdown';
import type { displayChart } from '@nao/shared/tools';
import type { ReactNode } from 'react';

import SlackIcon from '@/components/icons/slack.svg';
import { ChartDisplay } from '@/components/tool-calls/display-chart';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useTimeAgo } from '@/hooks/use-time-ago';
import { cn } from '@/lib/utils';

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
	config: displayChart.Input;
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

export type ActivityTrigger = 'schedule' | 'manual' | 'system';

export type ShareVisibility = 'project' | 'specific';

type ActivityBaseFields = {
	id: string;
	status: AutomationFeedRunStatus;
	trigger: ActivityTrigger;
	startedAt: string | Date;
	completedAt: string | Date | null;
	errorMessage?: string | null;
};

export type ActivityFeedStoryRefreshItem = {
	kind: 'activity';
	id: string;
	startedAt: string | Date;
	activity: ActivityBaseFields & {
		type: 'story.refreshed';
		queriesRefreshed: number;
	};
	story: {
		id: string;
		slug: string;
		title: string;
		chatId: string | null;
		cacheSchedule: string | null;
		cacheScheduleDescription: string | null;
	};
};

export type ActivityFeedStorySharedItem = {
	kind: 'activity';
	id: string;
	startedAt: string | Date;
	activity: ActivityBaseFields & { type: 'story.shared' };
	story: {
		id: string;
		slug: string;
		title: string;
		chatId: string | null;
	};
	share: { id: string; visibility: ShareVisibility };
	actorName: string | null;
};

export type ActivityFeedChatSharedItem = {
	kind: 'activity';
	id: string;
	startedAt: string | Date;
	activity: ActivityBaseFields & { type: 'chat.shared' };
	chat: { id: string; title: string };
	share: { id: string; visibility: ShareVisibility };
	actorName: string | null;
};

export type ActivityFeedItem = ActivityFeedStoryRefreshItem | ActivityFeedStorySharedItem | ActivityFeedChatSharedItem;

export type AutomationFeedItem = AutomationFeedAutomationItem | ActivityFeedItem;

const TEXT_CLAMP_LINES = 8;

export function AutomationsFeed({
	items,
	isLoading,
	hasAutomations,
	lastSeenAt = 0,
	onCancelRun,
	cancellingRunId,
}: {
	items: AutomationFeedItem[];
	isLoading: boolean;
	hasAutomations: boolean;
	lastSeenAt?: number;
	onCancelRun?: (runId: string) => void;
	cancellingRunId?: string | null;
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
}) {
	if (props.item.kind === 'activity') {
		return <ActivityCard item={props.item} isNew={props.isNew} />;
	}
	return (
		<AutomationRunCard
			item={props.item}
			isNew={props.isNew}
			onCancelRun={props.onCancelRun}
			isCancelling={props.isCancelling}
		/>
	);
}

function ActivityCard({ item, isNew }: { item: ActivityFeedItem; isNew?: boolean }) {
	switch (item.activity.type) {
		case 'story.refreshed':
			return <StoryRefreshCard item={item as ActivityFeedStoryRefreshItem} isNew={isNew} />;
		case 'story.shared':
			return <StorySharedCard item={item as ActivityFeedStorySharedItem} isNew={isNew} />;
		case 'chat.shared':
			return <ChatSharedCard item={item as ActivityFeedChatSharedItem} isNew={isNew} />;
		default:
			return null;
	}
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
}: {
	item: AutomationFeedAutomationItem;
	isNew?: boolean;
	onCancelRun?: (runId: string) => void;
	isCancelling?: boolean;
}) {
	const { run, automation, output } = item;
	const startedAt = new Date(run.startedAt);
	const timeAgo = useTimeAgo(startedAt.getTime());
	const isRunning = run.status === 'running';

	return (
		<article
			className={cn(
				'relative rounded-xl border bg-background/60 shadow-xs transition-colors',
				isNew && 'border-primary/30 bg-primary/[0.02]',
			)}
		>
			{isNew && <span aria-hidden className='absolute -left-1.5 top-4 h-6 w-1 rounded-full bg-primary' />}
			<header className='flex items-center justify-between gap-3 px-4 pt-4'>
				<div className='flex min-w-0 items-center gap-2'>
					<Link
						to='/automations/$automationId'
						params={{ automationId: automation.id }}
						className='truncate text-sm font-semibold hover:underline'
					>
						{automation.title}
					</Link>
					<span className='text-muted-foreground/60 text-xs' title={startedAt.toLocaleString()}>
						· {timeAgo.humanReadable}
					</span>
				</div>
				<RunStatusBadge status={run.status} integrationResults={run.integrationResults} />
			</header>

			{automation.scheduleDescription && (
				<div className='px-4 pt-1 text-xs text-muted-foreground'>{automation.scheduleDescription}</div>
			)}

			<div className='px-4 py-3'>
				<RunBody output={output} isRunning={isRunning} errorMessage={run.errorMessage} />
			</div>

			<footer className='flex items-center justify-between gap-2 border-t px-4 py-2.5'>
				<IntegrationResultIcons results={run.integrationResults} />
				<div className='flex items-center gap-1'>
					{isRunning && onCancelRun && (
						<Button
							variant='ghost'
							size='sm'
							className='gap-1.5 text-muted-foreground hover:text-destructive'
							disabled={isCancelling}
							onClick={() => onCancelRun(run.id)}
						>
							{isCancelling ? <Loader2 className='size-3.5 animate-spin' /> : <X className='size-3.5' />}
							<span className='text-xs'>{isCancelling ? 'Cancelling…' : 'Cancel'}</span>
						</Button>
					)}
					{run.chatId && (
						<Button variant='ghost' size='sm' asChild>
							<Link to='/$chatId' params={{ chatId: run.chatId }} className='gap-1.5'>
								<MessageSquare className='size-3.5' />
								<span className='text-xs'>Open chat</span>
							</Link>
						</Button>
					)}
				</div>
			</footer>
		</article>
	);
}

function StoryRefreshCard({ item, isNew = false }: { item: ActivityFeedStoryRefreshItem; isNew?: boolean }) {
	const { activity, story } = item;
	const startedAt = new Date(activity.startedAt);
	const timeAgo = useTimeAgo(startedAt.getTime());
	const isRunning = activity.status === 'running';

	const cadenceLabel = story.cacheScheduleDescription || formatCadenceFromCron(story.cacheSchedule);
	const triggerLabel = activity.trigger === 'manual' ? 'Manual refresh' : 'Scheduled refresh';

	return (
		<article
			className={cn(
				'relative rounded-xl border bg-background/60 shadow-xs transition-colors',
				isNew && 'border-primary/30 bg-primary/[0.02]',
			)}
		>
			{isNew && <span aria-hidden className='absolute -left-1.5 top-4 h-6 w-1 rounded-full bg-primary' />}
			<header className='flex items-center justify-between gap-3 px-4 pt-4'>
				<div className='flex min-w-0 items-center gap-2'>
					<RefreshCw
						className={cn('size-3.5 shrink-0 text-muted-foreground', isRunning && 'animate-spin')}
						aria-hidden
					/>
					{story.chatId ? (
						<Link
							to='/stories/preview/$chatId/$storySlug'
							params={{ chatId: story.chatId, storySlug: story.slug }}
							className='truncate text-sm font-semibold hover:underline'
						>
							{story.title}
						</Link>
					) : (
						<span className='truncate text-sm font-semibold'>{story.title}</span>
					)}
					<span className='text-muted-foreground/60 text-xs' title={startedAt.toLocaleString()}>
						· {timeAgo.humanReadable}
					</span>
				</div>
				<StoryRefreshStatusBadge status={activity.status} />
			</header>

			<div className='flex flex-wrap items-center gap-x-3 gap-y-1 px-4 pt-1 text-xs text-muted-foreground'>
				<span className='inline-flex items-center gap-1'>
					<span>{triggerLabel}</span>
					{cadenceLabel && activity.trigger === 'schedule' && <span>· {cadenceLabel}</span>}
				</span>
			</div>

			<div className='px-4 py-3'>
				<StoryRefreshBody
					status={activity.status}
					queriesRefreshed={activity.queriesRefreshed}
					errorMessage={activity.errorMessage}
				/>
			</div>

			<footer className='flex items-center justify-between gap-2 border-t px-4 py-2.5'>
				<span className='text-xs text-muted-foreground'>Live story</span>
				{story.chatId && (
					<Button variant='ghost' size='sm' asChild>
						<Link
							to='/stories/preview/$chatId/$storySlug'
							params={{ chatId: story.chatId, storySlug: story.slug }}
							className='gap-1.5'
						>
							<ExternalLink className='size-3.5' />
							<span className='text-xs'>Open story</span>
						</Link>
					</Button>
				)}
			</footer>
		</article>
	);
}

function StoryRefreshStatusBadge({ status }: { status: AutomationFeedRunStatus }) {
	if (status === 'failed') {
		return (
			<Badge variant='destructive' className='shrink-0'>
				Refresh failed
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
				Refreshing
			</Badge>
		);
	}
	return (
		<Badge
			variant='secondary'
			className='shrink-0 border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400'
		>
			Refreshed
		</Badge>
	);
}

function StoryRefreshBody({
	status,
	queriesRefreshed,
	errorMessage,
}: {
	status: AutomationFeedRunStatus;
	queriesRefreshed: number;
	errorMessage?: string | null;
}) {
	if (status === 'running') {
		return <p className='text-sm text-muted-foreground italic'>Refreshing data…</p>;
	}
	if (status === 'failed') {
		return (
			<p className='rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive'>
				{errorMessage || 'Refresh failed.'}
			</p>
		);
	}
	if (queriesRefreshed === 0) {
		return <p className='text-sm text-muted-foreground italic'>No queries to refresh.</p>;
	}
	return (
		<p className='text-sm text-foreground/90'>
			Re-ran <span className='font-semibold'>{queriesRefreshed}</span>{' '}
			{queriesRefreshed === 1 ? 'query' : 'queries'} against the latest data.
		</p>
	);
}

function StorySharedCard({ item, isNew = false }: { item: ActivityFeedStorySharedItem; isNew?: boolean }) {
	const { activity, story, share, actorName } = item;
	const startedAt = new Date(activity.startedAt);
	const timeAgo = useTimeAgo(startedAt.getTime());

	return (
		<article
			className={cn(
				'relative rounded-xl border bg-background/60 shadow-xs transition-colors',
				isNew && 'border-primary/30 bg-primary/[0.02]',
			)}
		>
			{isNew && <span aria-hidden className='absolute -left-1.5 top-4 h-6 w-1 rounded-full bg-primary' />}
			<header className='flex items-center justify-between gap-3 px-4 pt-4'>
				<div className='flex min-w-0 items-center gap-2'>
					<Share2 className='size-3.5 shrink-0 text-muted-foreground' aria-hidden />
					{story.chatId ? (
						<Link
							to='/stories/preview/$chatId/$storySlug'
							params={{ chatId: story.chatId, storySlug: story.slug }}
							className='truncate text-sm font-semibold hover:underline'
						>
							{story.title}
						</Link>
					) : (
						<span className='truncate text-sm font-semibold'>{story.title}</span>
					)}
					<span className='text-muted-foreground/60 text-xs' title={startedAt.toLocaleString()}>
						· {timeAgo.humanReadable}
					</span>
				</div>
				<ShareScopeBadge visibility={share.visibility} />
			</header>

			<div className='px-4 pt-1 pb-3 text-sm text-foreground/90'>
				<ShareSentence subjectLabel='story' actorName={actorName} visibility={share.visibility} />
			</div>

			<footer className='flex items-center justify-between gap-2 border-t px-4 py-2.5'>
				<span className='text-xs text-muted-foreground'>Shared story</span>
				{story.chatId && (
					<Button variant='ghost' size='sm' asChild>
						<Link
							to='/stories/preview/$chatId/$storySlug'
							params={{ chatId: story.chatId, storySlug: story.slug }}
							className='gap-1.5'
						>
							<ExternalLink className='size-3.5' />
							<span className='text-xs'>Open story</span>
						</Link>
					</Button>
				)}
			</footer>
		</article>
	);
}

function ChatSharedCard({ item, isNew = false }: { item: ActivityFeedChatSharedItem; isNew?: boolean }) {
	const { activity, chat, share, actorName } = item;
	const startedAt = new Date(activity.startedAt);
	const timeAgo = useTimeAgo(startedAt.getTime());

	return (
		<article
			className={cn(
				'relative rounded-xl border bg-background/60 shadow-xs transition-colors',
				isNew && 'border-primary/30 bg-primary/[0.02]',
			)}
		>
			{isNew && <span aria-hidden className='absolute -left-1.5 top-4 h-6 w-1 rounded-full bg-primary' />}
			<header className='flex items-center justify-between gap-3 px-4 pt-4'>
				<div className='flex min-w-0 items-center gap-2'>
					<Share2 className='size-3.5 shrink-0 text-muted-foreground' aria-hidden />
					<Link
						to='/$chatId'
						params={{ chatId: chat.id }}
						className='truncate text-sm font-semibold hover:underline'
					>
						{chat.title || 'Untitled chat'}
					</Link>
					<span className='text-muted-foreground/60 text-xs' title={startedAt.toLocaleString()}>
						· {timeAgo.humanReadable}
					</span>
				</div>
				<ShareScopeBadge visibility={share.visibility} />
			</header>

			<div className='px-4 pt-1 pb-3 text-sm text-foreground/90'>
				<ShareSentence subjectLabel='chat' actorName={actorName} visibility={share.visibility} />
			</div>

			<footer className='flex items-center justify-between gap-2 border-t px-4 py-2.5'>
				<span className='text-xs text-muted-foreground'>Shared chat</span>
				<Button variant='ghost' size='sm' asChild>
					<Link to='/$chatId' params={{ chatId: chat.id }} className='gap-1.5'>
						<MessageSquare className='size-3.5' />
						<span className='text-xs'>Open chat</span>
					</Link>
				</Button>
			</footer>
		</article>
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
			<span className='font-medium'>{actor}</span> shared this {subjectLabel} with{' '}
			<span className='font-medium'>{target}</span>.
		</p>
	);
}

function ShareScopeBadge({ visibility }: { visibility: ShareVisibility }) {
	return (
		<Badge variant='secondary' className='shrink-0'>
			{visibility === 'project' ? 'Project' : 'Direct'}
		</Badge>
	);
}

function formatCadenceFromCron(cron: string | null): string | null {
	if (!cron) {
		return null;
	}
	const known: Record<string, string> = {
		'*/5 * * * *': 'Every 5 minutes',
		'0 * * * *': 'Every hour',
		'0 0 * * *': 'Every 24 hours',
		'0 0 * * 1': 'Weekly (Monday)',
		'0 0 1 * *': 'Monthly (1st)',
	};
	return known[cron] ?? cron;
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
				<Streamdown>{text}</Streamdown>
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
				series={chart.config.series}
				title={chart.config.title}
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
		return <div />;
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
