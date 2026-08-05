import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import {
	ArrowDown01,
	ArrowDownUp,
	ArrowDownWideNarrow,
	ArrowUp01,
	ArrowUpWideNarrow,
	ClockArrowDown,
	ClockArrowUp,
	ListFilter,
	X,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
	CONTEXT_RECOMMENDATION_CATEGORIES,
	CONTEXT_RECOMMENDATION_CATEGORY_LABELS,
	MAX_TRIGGER_CHATS,
	normalizeContextRecommendationCategory,
} from '@nao/shared/context-recommendation';
import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

import type { TrpcRouter } from '@nao/backend/trpc';
import type { LlmProvider } from '@nao/shared/types';
import type { inferRouterOutputs } from '@trpc/server';

import type { TabBarItem } from '@/components/ui/tab-bar';

import { RecommendationCard } from '@/components/recommendation-card';
import { RecommendationRepoCard } from '@/components/recommendation-repo-card';
import { SidePanel } from '@/components/side-panel/side-panel';
import { Button } from '@/components/ui/button';
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Empty } from '@/components/ui/empty';
import { LlmProviderIcon } from '@/components/ui/llm-provider-icon';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { SettingsCard, SettingsPageWrapper } from '@/components/ui/settings-card';
import { Spinner } from '@/components/ui/spinner';
import { TabBar } from '@/components/ui/tab-bar';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { validateRecommendationsSearch } from '@/components/settings/recommendations-route-search';
import { SidePanelProvider } from '@/contexts/side-panel';
import { useRecommendationsViewState } from '@/hooks/use-recommendations-view-state';
import { useSidePanel } from '@/hooks/use-side-panel';
import { requireContextAdminOrAdmin } from '@/lib/require-admin';
import { cn } from '@/lib/utils';
import { trpc } from '@/main';

export const Route = createFileRoute('/_sidebar-layout/settings/recommendations')({
	beforeLoad: requireContextAdminOrAdmin,
	validateSearch: validateRecommendationsSearch,
	component: RecommendationsPage,
});

const PAGE_DESCRIPTION = "Diagnostic suggestions for improving this project's context, mined from real usage.";

/** How long a run must be in progress before the cancel escape hatch appears. */
const RUN_CANCEL_THRESHOLD_MS = 60 * 1000;

const FREQUENCY_OPTIONS = [
	{ value: 'daily', label: 'Daily' },
	{ value: 'weekly', label: 'Weekly' },
	{ value: 'monthly', label: 'Monthly' },
] as const;

type Frequency = (typeof FREQUENCY_OPTIONS)[number]['value'];

type SortOrder = 'desc' | 'asc';
type SortKey = 'date' | 'triggers' | 'pr';

const SORT_OPTIONS: { value: SortKey; label: string }[] = [
	{ value: 'date', label: 'Date detected' },
	{ value: 'triggers', label: 'Triggering chats' },
	{ value: 'pr', label: 'PR status' },
];

const SORT_ICONS: Record<SortKey, { asc: LucideIcon; desc: LucideIcon }> = {
	date: { asc: ClockArrowUp, desc: ClockArrowDown },
	triggers: { asc: ArrowUp01, desc: ArrowDown01 },
	pr: { asc: ArrowUpWideNarrow, desc: ArrowDownWideNarrow },
};

function sortDirectionLabel(sortKey: SortKey, sortOrder: SortOrder): string {
	if (sortKey === 'date') {
		return sortOrder === 'desc' ? 'Newest first' : 'Oldest first';
	}
	if (sortKey === 'triggers') {
		return sortOrder === 'desc' ? 'Most chats' : 'Fewest chats';
	}
	return sortOrder === 'desc' ? 'PR first' : 'No PR first';
}

const ALL_FILTER = 'all';

type FeedbackFilter = 'with' | 'without';

const FEEDBACK_FILTERS: readonly FeedbackFilter[] = ['with', 'without'];

const FEEDBACK_FILTER_LABELS: Record<FeedbackFilter, string> = {
	with: 'With feedback',
	without: 'Without feedback',
};

const MAX_AUTO_PR_OPTIONS = [1, 2, 3, 5, 10] as const;
const DEFAULT_MAX_AUTO_PRS = 3;
const MAX_CUSTOM_SYSTEM_PROMPT_INSTRUCTIONS_LENGTH = 4000;

type TopTab = 'config' | 'recommendations' | 'applied' | 'dismissed';

/** The job runs at 03:00 UTC; render that moment in the viewer's local timezone (display only). */
function localRunTime(): string {
	const at = new Date();
	at.setUTCHours(3, 0, 0, 0);
	return at.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function triggerChatIds(rec: Recommendation): string[] {
	const ids = new Set<string>();
	for (const insight of rec.insights ?? []) {
		for (const ref of insight.triggerRefs ?? []) {
			ids.add(ref.chatId);
		}
	}
	return [...ids];
}

function prRank(rec: Recommendation): number {
	if (rec.prUrl) {
		return 2;
	}
	const hasPatch = rec.fixKind === 'patch' && (rec.proposedEdits?.length ?? 0) > 0;
	return hasPatch ? 1 : 0;
}

function RecommendationsPage() {
	const queryClient = useQueryClient();
	const search = Route.useSearch();
	const containerRef = useRef<HTMLDivElement>(null);
	const sidePanelRef = useRef<HTMLDivElement>(null);
	const [activeTab, setActiveTab] = useState<TopTab>(search.tab ?? 'recommendations');
	const sidePanel = useSidePanel({
		containerRef,
		sidePanelRef,
		defaultWidthRatio: 0.5,
		shouldCollapseSidebar: false,
	});
	const systemConfig = useQuery(trpc.system.getPublicConfig.queryOptions());
	const isEnabled = systemConfig.data?.betaContextRecommendationsEnabled === true;
	const recommendations = useQuery({ ...trpc.contextRecommendation.list.queryOptions({}), enabled: isEnabled });
	const latestRun = useQuery({
		...trpc.contextRecommendation.latestRun.queryOptions(),
		enabled: isEnabled,
		refetchInterval: (query) => (query.state.data?.status === 'running' ? 3000 : false),
	});

	const setStatus = useMutation(trpc.contextRecommendation.setStatus.mutationOptions());
	const run = useMutation(trpc.contextRecommendation.run.mutationOptions());
	const cancelRun = useMutation(trpc.contextRecommendation.cancelRun.mutationOptions());

	const runningRun = latestRun.data?.status === 'running' ? latestRun.data : null;
	const isRunning = run.isPending || runningRun !== null;

	const [nowMs, setNowMs] = useState(() => Date.now());
	useEffect(() => {
		if (!runningRun) {
			return;
		}
		const interval = setInterval(() => setNowMs(Date.now()), 1000);
		return () => clearInterval(interval);
	}, [runningRun]);

	const canCancelRun =
		runningRun !== null && nowMs - new Date(runningRun.startedAt).getTime() >= RUN_CANCEL_THRESHOLD_MS;

	const handleRun = async () => {
		await run.mutateAsync();
		queryClient.invalidateQueries({ queryKey: trpc.contextRecommendation.latestRun.queryKey() });
	};

	const handleCancelRun = async () => {
		if (!runningRun) {
			return;
		}
		await cancelRun.mutateAsync({ runId: runningRun.id });
		queryClient.invalidateQueries({ queryKey: trpc.contextRecommendation.latestRun.queryKey() });
	};

	const previousRunStatus = useRef(latestRun.data?.status);
	useEffect(() => {
		const status = latestRun.data?.status;
		if (previousRunStatus.current === 'running' && status && status !== 'running') {
			queryClient.invalidateQueries({ queryKey: trpc.contextRecommendation.list.queryKey({}) });
		}
		previousRunStatus.current = status;
	}, [latestRun.data?.status, queryClient]);

	const activeRecommendations = useMemo(
		() => recommendations.data?.filter((rec) => rec.status === 'open') ?? [],
		[recommendations.data],
	);
	const appliedRecommendations = useMemo(
		() => recommendations.data?.filter((rec) => rec.status === 'applied') ?? [],
		[recommendations.data],
	);
	const dismissedRecommendations = useMemo(
		() => recommendations.data?.filter((rec) => rec.status === 'dismissed') ?? [],
		[recommendations.data],
	);

	const baseList =
		activeTab === 'applied'
			? appliedRecommendations
			: activeTab === 'dismissed'
				? dismissedRecommendations
				: activeRecommendations;

	const [view, setView] = useRecommendationsViewState({
		sortKey: 'date' as SortKey,
		sortOrder: 'desc' as SortOrder,
		categoryFilter: ALL_FILTER,
		userFilter: ALL_FILTER,
		feedbackFilter: ALL_FILTER,
	});
	const { sortKey, sortOrder, categoryFilter, userFilter, feedbackFilter } = view;
	const setSortKey = (value: SortKey) => setView({ sortKey: value });
	const setSortOrder = (value: SortOrder) => setView({ sortOrder: value });
	const setCategoryFilter = (value: string) => setView({ categoryFilter: value });
	const setUserFilter = (value: string) => setView({ userFilter: value });
	const setFeedbackFilter = (value: string) => setView({ feedbackFilter: value });

	const previousTab = useRef(activeTab);
	useEffect(() => {
		if (previousTab.current === activeTab) {
			return;
		}
		previousTab.current = activeTab;
		setView({ categoryFilter: ALL_FILTER, userFilter: ALL_FILTER, feedbackFilter: ALL_FILTER });
	}, [activeTab, setView]);

	const triggerChatIdChunks = useMemo(() => {
		const ids = new Set<string>();
		for (const rec of baseList) {
			for (const id of triggerChatIds(rec)) {
				ids.add(id);
			}
		}
		const allIds = [...ids];
		const chunks: string[][] = [];
		for (let i = 0; i < allIds.length; i += MAX_TRIGGER_CHATS) {
			chunks.push(allIds.slice(i, i + MAX_TRIGGER_CHATS));
		}
		return chunks;
	}, [baseList]);

	const chatMetadata = useQueries({
		queries: triggerChatIdChunks.map((chatIds) => ({
			...trpc.contextRecommendation.listRecoTriggerChatMetadata.queryOptions({ chatIds }),
			enabled: isEnabled && activeTab !== 'config' && chatIds.length > 0,
			staleTime: 60_000,
		})),
		combine: (results) => results.flatMap((result) => result.data ?? []),
	});

	const chatUserById = useMemo(() => {
		const map = new Map<string, { userId: string; userName: string }>();
		for (const meta of chatMetadata) {
			if (meta.userId) {
				map.set(meta.chatId, { userId: meta.userId, userName: meta.userName || 'Unknown user' });
			}
		}
		return map;
	}, [chatMetadata]);

	const userOptions = useMemo(() => {
		const byUser = new Map<string, string>();
		for (const rec of baseList) {
			for (const chatId of triggerChatIds(rec)) {
				const user = chatUserById.get(chatId);
				if (user && !byUser.has(user.userId)) {
					byUser.set(user.userId, user.userName);
				}
			}
		}
		return [...byUser.entries()]
			.map(([userId, userName]) => ({ userId, userName }))
			.sort((a, b) => a.userName.localeCompare(b.userName));
	}, [baseList, chatUserById]);

	const categoryCounts = useMemo(() => {
		const counts = new Map<string, number>();
		for (const rec of baseList) {
			const category = normalizeContextRecommendationCategory(rec.category);
			counts.set(category, (counts.get(category) ?? 0) + 1);
		}
		return counts;
	}, [baseList]);

	const feedbackCounts = useMemo(() => {
		const counts = new Map<FeedbackFilter, number>();
		for (const rec of baseList) {
			const hasFeedback = (rec.feedbacks ?? []).length > 0;
			const key: FeedbackFilter = hasFeedback ? 'with' : 'without';
			counts.set(key, (counts.get(key) ?? 0) + 1);
		}
		return counts;
	}, [baseList]);

	const feedbackOptions = useMemo(
		() => FEEDBACK_FILTERS.filter((filter) => (feedbackCounts.get(filter) ?? 0) > 0),
		[feedbackCounts],
	);

	const displayedRecommendations = useMemo(() => {
		const filtered = baseList.filter((rec) => {
			if (
				categoryFilter !== ALL_FILTER &&
				normalizeContextRecommendationCategory(rec.category) !== categoryFilter
			) {
				return false;
			}
			if (userFilter !== ALL_FILTER) {
				const triggeredByUser = triggerChatIds(rec).some(
					(chatId) => chatUserById.get(chatId)?.userId === userFilter,
				);
				if (!triggeredByUser) {
					return false;
				}
			}
			if (feedbackFilter !== ALL_FILTER) {
				const hasFeedback = (rec.feedbacks ?? []).length > 0;
				if (feedbackFilter === 'with' ? !hasFeedback : hasFeedback) {
					return false;
				}
			}
			return true;
		});

		const sorted = [...filtered].sort((a, b) => {
			let cmp = 0;
			if (sortKey === 'date') {
				cmp = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
			} else if (sortKey === 'triggers') {
				cmp = triggerChatIds(a).length - triggerChatIds(b).length;
			} else {
				cmp = prRank(a) - prRank(b);
			}
			return sortOrder === 'desc' ? -cmp : cmp;
		});
		return sorted;
	}, [baseList, categoryFilter, userFilter, feedbackFilter, sortKey, sortOrder, chatUserById]);

	const hasActiveFilters =
		categoryFilter !== ALL_FILTER || userFilter !== ALL_FILTER || feedbackFilter !== ALL_FILTER;

	const clearFilters = () => {
		setCategoryFilter(ALL_FILTER);
		setUserFilter(ALL_FILTER);
		setFeedbackFilter(ALL_FILTER);
	};

	const changeStatus = async (id: string, status: 'applied' | 'dismissed') => {
		await setStatus.mutateAsync({ id, status });
		queryClient.invalidateQueries({ queryKey: trpc.contextRecommendation.list.queryKey({}) });
	};

	if (systemConfig.data && !isEnabled) {
		return (
			<SettingsPageWrapper>
				<SettingsCard title='Context Recommendations' titleSize='lg' description={PAGE_DESCRIPTION}>
					<Empty className='whitespace-normal'>
						This feature is currently in beta. To enable it, set the environment variable{' '}
						<code className='rounded bg-muted px-1 py-0.5 font-mono text-xs'>
							BETA_CONTEXT_RECOMMENDATIONS_ENABLED=true
						</code>{' '}
						on your nao instance and restart it.
					</Empty>
				</SettingsCard>
			</SettingsPageWrapper>
		);
	}

	const topTabs: TabBarItem<TopTab>[] = [
		{ id: 'config', label: 'Config' },
		{ id: 'recommendations', label: 'Recommendations', count: activeRecommendations.length },
		{ id: 'applied', label: 'Applied', count: appliedRecommendations.length },
		{ id: 'dismissed', label: 'Dismissed', count: dismissedRecommendations.length },
	];

	return (
		<SidePanelProvider
			isVisible={sidePanel.isVisible}
			currentStorySlug={sidePanel.currentStorySlug}
			setCurrentStorySlug={sidePanel.setCurrentStorySlug}
			currentStoryTabIndex={sidePanel.currentStoryTabIndex}
			setCurrentStoryTabIndex={sidePanel.setCurrentStoryTabIndex}
			chatId={null}
			open={sidePanel.open}
			close={sidePanel.close}
		>
			<div ref={containerRef} className='flex h-full min-h-0'>
				<SettingsPageWrapper>
					<div className='flex flex-col gap-6'>
						<div className='flex items-start justify-between gap-4'>
							<div className='space-y-1'>
								<h1 className='text-xl font-semibold text-foreground'>Context Recommendations</h1>
								<p className='text-sm text-muted-foreground'>{PAGE_DESCRIPTION}</p>
							</div>
							<div className='flex flex-col items-end gap-1'>
								<div className='flex items-center gap-2'>
									{canCancelRun && (
										<Button
											size='sm'
											variant='ghost'
											className='gap-1.5 text-muted-foreground hover:text-destructive'
											onClick={handleCancelRun}
											disabled={cancelRun.isPending}
										>
											{cancelRun.isPending ? (
												<Spinner className='size-4' />
											) : (
												<X className='size-4' />
											)}
											{cancelRun.isPending ? 'Cancelling…' : 'Cancel'}
										</Button>
									)}
									<Button size='sm' onClick={handleRun} disabled={isRunning}>
										{isRunning && <Spinner className='size-4' />}
										{isRunning ? 'Running…' : 'Run now'}
									</Button>
								</div>
								{latestRun.data ? (
									<span className='text-xs text-muted-foreground italic'>
										Latest {new Date(latestRun.data.startedAt).toLocaleString()}
									</span>
								) : (
									<span className='text-xs text-muted-foreground italic'>Never run</span>
								)}
							</div>
						</div>

						<div className='sticky top-0 z-20 -mt-2 bg-background pt-2'>
							<div className='flex flex-wrap items-center gap-x-4 gap-y-2 border-b'>
								<TabBar tabs={topTabs} activeTab={activeTab} onTabChange={setActiveTab} />
								{activeTab !== 'config' && (
									<RecommendationsToolbar
										categoryFilter={categoryFilter}
										onCategoryFilterChange={setCategoryFilter}
										categoryCounts={categoryCounts}
										userFilter={userFilter}
										onUserFilterChange={setUserFilter}
										userOptions={userOptions}
										feedbackFilter={feedbackFilter}
										onFeedbackFilterChange={setFeedbackFilter}
										feedbackOptions={feedbackOptions}
										feedbackCounts={feedbackCounts}
										sortKey={sortKey}
										onSortKeyChange={setSortKey}
										sortOrder={sortOrder}
										onSortOrderChange={setSortOrder}
										hasActiveFilters={hasActiveFilters}
										onClearFilters={clearFilters}
									/>
								)}
							</div>
						</div>

						{activeTab === 'config' && <ConfigTab enabled={isEnabled} />}

						{activeTab === 'recommendations' && (
							<RecommendationsTab
								isLoading={recommendations.isLoading}
								isError={recommendations.isError && !recommendations.data}
								errorMessage={recommendations.error?.message}
								hasAny={baseList.length > 0}
								recommendations={displayedRecommendations}
								onChangeStatus={changeStatus}
								isPending={setStatus.isPending}
								openChatsRecId={search.openChats}
							/>
						)}

						{activeTab === 'applied' && (
							<ArchiveTab
								isLoading={recommendations.isLoading}
								isError={recommendations.isError && !recommendations.data}
								errorMessage={recommendations.error?.message}
								recommendations={displayedRecommendations}
								hasAny={baseList.length > 0}
								onChangeStatus={changeStatus}
								isPending={setStatus.isPending}
								emptyLabel='Nothing applied yet. Recommendations you mark as applied land here.'
								openChatsRecId={search.openChats}
							/>
						)}

						{activeTab === 'dismissed' && (
							<ArchiveTab
								isLoading={recommendations.isLoading}
								isError={recommendations.isError && !recommendations.data}
								errorMessage={recommendations.error?.message}
								recommendations={displayedRecommendations}
								hasAny={baseList.length > 0}
								onChangeStatus={changeStatus}
								isPending={setStatus.isPending}
								emptyLabel='Nothing dismissed yet. Recommendations you dismiss land here.'
								openChatsRecId={search.openChats}
							/>
						)}
					</div>
				</SettingsPageWrapper>

				{sidePanel.content && (
					<SidePanel
						containerRef={containerRef}
						isAnimating={sidePanel.isAnimating}
						sidePanelRef={sidePanelRef}
						resizeHandleRef={sidePanel.resizeHandleRef}
					>
						{sidePanel.content}
					</SidePanel>
				)}
			</div>
		</SidePanelProvider>
	);
}

type Recommendation = inferRouterOutputs<TrpcRouter>['contextRecommendation']['list'][number];

type ChangeStatus = (id: string, status: 'applied' | 'dismissed') => void;

interface RecommendationsTabProps {
	isLoading: boolean;
	isError: boolean;
	errorMessage?: string;
	hasAny: boolean;
	recommendations: Recommendation[];
	onChangeStatus: ChangeStatus;
	isPending: boolean;
	openChatsRecId?: string;
}

const NO_MATCHES_LABEL = 'No recommendations match your filters.';

function RecommendationsTab({
	isLoading,
	isError,
	errorMessage,
	hasAny,
	recommendations,
	onChangeStatus,
	isPending,
	openChatsRecId,
}: RecommendationsTabProps) {
	if (isLoading) {
		return (
			<div className='flex justify-center p-6'>
				<Spinner />
			</div>
		);
	}
	if (isError) {
		return <Empty>Failed to load recommendations: {errorMessage ?? 'unknown error'}</Empty>;
	}
	if (!hasAny) {
		return <Empty>No recommendations yet. They appear after the next analysis run.</Empty>;
	}

	return (
		<RecommendationList
			recommendations={recommendations}
			onChangeStatus={onChangeStatus}
			isPending={isPending}
			emptyLabel={NO_MATCHES_LABEL}
			openChatsRecId={openChatsRecId}
		/>
	);
}

interface ArchiveTabProps {
	isLoading: boolean;
	isError: boolean;
	errorMessage?: string;
	recommendations: Recommendation[];
	hasAny: boolean;
	onChangeStatus: ChangeStatus;
	isPending: boolean;
	emptyLabel: string;
	openChatsRecId?: string;
}

function ArchiveTab({
	isLoading,
	isError,
	errorMessage,
	recommendations,
	hasAny,
	onChangeStatus,
	isPending,
	emptyLabel,
	openChatsRecId,
}: ArchiveTabProps) {
	if (isLoading) {
		return (
			<div className='flex justify-center p-6'>
				<Spinner />
			</div>
		);
	}
	if (isError) {
		return <Empty>Failed to load recommendations: {errorMessage ?? 'unknown error'}</Empty>;
	}
	if (!hasAny) {
		return <Empty>{emptyLabel}</Empty>;
	}
	return (
		<RecommendationList
			recommendations={recommendations}
			onChangeStatus={onChangeStatus}
			isPending={isPending}
			emptyLabel={NO_MATCHES_LABEL}
			defaultCollapsed
			readOnly
			openChatsRecId={openChatsRecId}
		/>
	);
}

interface RecommendationListProps {
	recommendations: Recommendation[];
	onChangeStatus: ChangeStatus;
	isPending: boolean;
	emptyLabel: string;
	defaultCollapsed?: boolean;
	readOnly?: boolean;
	openChatsRecId?: string;
}

function RecommendationList({
	recommendations,
	onChangeStatus,
	isPending,
	emptyLabel,
	defaultCollapsed = false,
	readOnly = false,
	openChatsRecId,
}: RecommendationListProps) {
	if (recommendations.length === 0) {
		return <Empty>{emptyLabel}</Empty>;
	}

	return (
		<div className='flex flex-col gap-3'>
			{recommendations.map((rec) => (
				<RecommendationCard
					key={rec.id}
					recommendation={rec}
					onChangeStatus={onChangeStatus}
					isPending={isPending}
					defaultCollapsed={defaultCollapsed}
					readOnly={readOnly}
					highlightOpen={rec.id === openChatsRecId}
				/>
			))}
		</div>
	);
}

interface RecommendationsToolbarProps {
	categoryFilter: string;
	onCategoryFilterChange: (value: string) => void;
	categoryCounts: Map<string, number>;
	userFilter: string;
	onUserFilterChange: (value: string) => void;
	userOptions: { userId: string; userName: string }[];
	feedbackFilter: string;
	onFeedbackFilterChange: (value: string) => void;
	feedbackOptions: FeedbackFilter[];
	feedbackCounts: Map<FeedbackFilter, number>;
	sortKey: SortKey;
	onSortKeyChange: (value: SortKey) => void;
	sortOrder: SortOrder;
	onSortOrderChange: (value: SortOrder) => void;
	hasActiveFilters: boolean;
	onClearFilters: () => void;
}

function ToolbarOption({
	selected,
	onSelect,
	count,
	children,
}: {
	selected: boolean;
	onSelect: () => void;
	count?: number;
	children: ReactNode;
}) {
	return (
		<DropdownMenuItem
			onSelect={(event) => {
				event.preventDefault();
				onSelect();
			}}
			className='justify-between gap-4 pr-2'
		>
			<span>
				{children}
				{count !== undefined && <span className='ml-3 text-muted-foreground'>{count}</span>}
			</span>
			<span className={cn('size-1.5 shrink-0 rounded-full bg-primary', !selected && 'invisible')} aria-hidden />
		</DropdownMenuItem>
	);
}

function RecommendationsToolbar({
	categoryFilter,
	onCategoryFilterChange,
	categoryCounts,
	userFilter,
	onUserFilterChange,
	userOptions,
	feedbackFilter,
	onFeedbackFilterChange,
	feedbackOptions,
	feedbackCounts,
	sortKey,
	onSortKeyChange,
	sortOrder,
	onSortOrderChange,
	hasActiveFilters,
	onClearFilters,
}: RecommendationsToolbarProps) {
	return (
		<div className='flex items-center gap-1 pb-2 sm:ml-auto sm:pb-0'>
			<DropdownMenu>
				<DropdownMenuTrigger asChild>
					<Button variant='ghost' className='relative h-8 px-2 text-muted-foreground' aria-label='Filter'>
						<span className='relative'>
							<ListFilter className='size-4' />
							{hasActiveFilters && (
								<span className='absolute -right-0.5 top-0 size-1.5 rounded-full bg-primary' />
							)}
						</span>
					</Button>
				</DropdownMenuTrigger>
				<DropdownMenuContent align='end' className='w-56'>
					<DropdownMenuLabel>Category</DropdownMenuLabel>
					{CONTEXT_RECOMMENDATION_CATEGORIES.map((category) => (
						<ToolbarOption
							key={category}
							selected={categoryFilter === category}
							onSelect={() => onCategoryFilterChange(categoryFilter === category ? ALL_FILTER : category)}
							count={categoryCounts.get(category) ?? 0}
						>
							{CONTEXT_RECOMMENDATION_CATEGORY_LABELS[category]}
						</ToolbarOption>
					))}
					{userOptions.length > 0 && (
						<>
							<DropdownMenuSeparator />
							<DropdownMenuLabel>User</DropdownMenuLabel>
							{userOptions.map((user) => (
								<ToolbarOption
									key={user.userId}
									selected={userFilter === user.userId}
									onSelect={() =>
										onUserFilterChange(userFilter === user.userId ? ALL_FILTER : user.userId)
									}
								>
									{user.userName}
								</ToolbarOption>
							))}
						</>
					)}
					{feedbackOptions.length > 0 && (
						<>
							<DropdownMenuSeparator />
							<DropdownMenuLabel>Feedback</DropdownMenuLabel>
							{feedbackOptions.map((filter) => (
								<ToolbarOption
									key={filter}
									selected={feedbackFilter === filter}
									onSelect={() =>
										onFeedbackFilterChange(feedbackFilter === filter ? ALL_FILTER : filter)
									}
									count={feedbackCounts.get(filter) ?? 0}
								>
									{FEEDBACK_FILTER_LABELS[filter]}
								</ToolbarOption>
							))}
						</>
					)}
					{hasActiveFilters && (
						<>
							<DropdownMenuSeparator />
							<DropdownMenuItem onSelect={onClearFilters}>
								<X className='size-3.5' />
								Clear filters
							</DropdownMenuItem>
						</>
					)}
				</DropdownMenuContent>
			</DropdownMenu>

			<DropdownMenu>
				<DropdownMenuTrigger asChild>
					<Button variant='ghost' className='h-8 gap-1.5 px-2 text-muted-foreground' aria-label='Sort'>
						<ArrowDownUp className='size-4' />
					</Button>
				</DropdownMenuTrigger>
				<DropdownMenuContent align='end' className='w-56'>
					<DropdownMenuLabel>Sort by</DropdownMenuLabel>
					{SORT_OPTIONS.map((option) => {
						const isActive = sortKey === option.value;
						const previewOrder: SortOrder = isActive ? sortOrder : 'asc';
						const Icon = SORT_ICONS[option.value][previewOrder];
						return (
							<DropdownMenuItem
								key={option.value}
								onSelect={(event) => {
									event.preventDefault();
									if (isActive) {
										onSortOrderChange(sortOrder === 'desc' ? 'asc' : 'desc');
									} else {
										onSortKeyChange(option.value);
										onSortOrderChange('desc');
									}
								}}
								className='justify-between gap-4 pr-2'
								title={sortDirectionLabel(option.value, previewOrder)}
							>
								<span>{option.label}</span>
								<Icon
									className={cn(
										'size-4 shrink-0',
										isActive ? 'text-primary' : 'text-muted-foreground',
									)}
								/>
							</DropdownMenuItem>
						);
					})}
				</DropdownMenuContent>
			</DropdownMenu>
		</div>
	);
}

function ConfigTab({ enabled }: { enabled: boolean }) {
	const queryClient = useQueryClient();
	const [customSystemPromptInstructions, setCustomSystemPromptInstructions] = useState('');
	const [customSystemPromptInstructionsEnabled, setCustomSystemPromptInstructionsEnabled] = useState(false);

	const availableModels = useQuery({ ...trpc.contextRecommendation.listAvailableModels.queryOptions(), enabled });
	const config = useQuery({ ...trpc.contextRecommendation.getConfig.queryOptions(), enabled });
	const setConfig = useMutation(trpc.contextRecommendation.setConfig.mutationOptions());

	const invalidateConfig = () => {
		queryClient.invalidateQueries({ queryKey: trpc.contextRecommendation.getConfig.queryKey() });
	};

	const selectedModelValue =
		config.data?.modelProvider && config.data?.modelId
			? `${config.data.modelProvider}:${config.data.modelId}`
			: undefined;

	const handleModelChange = async (value: string) => {
		const [provider, ...rest] = value.split(':');
		await setConfig.mutateAsync({ modelProvider: provider as LlmProvider, modelId: rest.join(':') });
		invalidateConfig();
	};

	const selectedFrequency: Frequency = config.data?.frequency ?? 'weekly';
	const savedCustomSystemPromptInstructions = config.data?.customSystemPromptInstructions ?? '';
	const hasCustomSystemPromptInstructionsChanges =
		customSystemPromptInstructions.trim() !== savedCustomSystemPromptInstructions.trim();

	useEffect(() => {
		setCustomSystemPromptInstructions(savedCustomSystemPromptInstructions);
		setCustomSystemPromptInstructionsEnabled(savedCustomSystemPromptInstructions.trim().length > 0);
	}, [savedCustomSystemPromptInstructions]);

	const handleFrequencyChange = async (value: string) => {
		await setConfig.mutateAsync({ frequency: value as Frequency });
		invalidateConfig();
	};

	const yoloEnabled = config.data?.autoCreatePrs === true;
	const maxAutoPrs = config.data?.maxAutoPrsPerRun ?? DEFAULT_MAX_AUTO_PRS;

	const handleYoloChange = async (checked: boolean) => {
		await setConfig.mutateAsync({ autoCreatePrs: checked });
		invalidateConfig();
	};

	const handleMaxAutoPrsChange = async (value: string) => {
		await setConfig.mutateAsync({ maxAutoPrsPerRun: Number(value) });
		invalidateConfig();
	};

	const handleCustomSystemPromptInstructionsSave = async () => {
		if (!hasCustomSystemPromptInstructionsChanges) {
			return;
		}
		await setConfig.mutateAsync({
			customSystemPromptInstructions: customSystemPromptInstructions.trim(),
		});
		invalidateConfig();
	};

	const handleCustomSystemPromptInstructionsEnabledChange = async (checked: boolean) => {
		setCustomSystemPromptInstructionsEnabled(checked);

		if (checked) {
			return;
		}

		if (!savedCustomSystemPromptInstructions.trim()) {
			setCustomSystemPromptInstructions('');
			return;
		}

		try {
			await setConfig.mutateAsync({ customSystemPromptInstructions: '' });
			setCustomSystemPromptInstructions('');
			invalidateConfig();
		} catch {
			// Keep the saved instructions and re-open the section so nothing is lost on a failed save.
			setCustomSystemPromptInstructionsEnabled(true);
		}
	};

	return (
		<div className='flex flex-col gap-6'>
			<SettingsCard>
				<div className='flex flex-col gap-4'>
					<div className='flex items-center justify-between gap-4'>
						<div className='text-sm'>Analysis model</div>
						<div className='w-72'>
							<Select
								value={selectedModelValue}
								onValueChange={handleModelChange}
								disabled={setConfig.isPending}
							>
								<SelectTrigger className='w-full'>
									<SelectValue placeholder='Project default' />
								</SelectTrigger>
								<SelectContent>
									{availableModels.data?.map((m) => (
										<SelectItem
											key={`${m.provider}:${m.modelId}`}
											value={`${m.provider}:${m.modelId}`}
										>
											<div className='flex items-center gap-2'>
												<LlmProviderIcon
													provider={m.provider}
													baseUrl={m.baseUrl}
													className='size-4'
												/>
												{m.name}
											</div>
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</div>
					</div>

					<div className='flex items-center justify-between gap-4'>
						<div>
							<div className='text-sm'>Run frequency</div>
							<div className='text-xs text-muted-foreground'>Runs at {localRunTime()} your time</div>
						</div>
						<div className='w-72'>
							<Select
								value={selectedFrequency}
								onValueChange={handleFrequencyChange}
								disabled={setConfig.isPending}
							>
								<SelectTrigger className='w-full'>
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									{FREQUENCY_OPTIONS.map((f) => (
										<SelectItem key={f.value} value={f.value}>
											{f.label}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</div>
					</div>

					<div className='flex flex-col gap-2'>
						<div className='flex items-center justify-between gap-4'>
							<div>
								<div className='text-sm'>Custom system prompt instructions</div>
								<div className='text-xs text-muted-foreground'>
									Added to every context recommendations run after the built-in audit instructions.
								</div>
							</div>
							<Switch
								checked={customSystemPromptInstructionsEnabled}
								onCheckedChange={handleCustomSystemPromptInstructionsEnabledChange}
								disabled={setConfig.isPending}
							/>
						</div>
						{customSystemPromptInstructionsEnabled && (
							<>
								<Textarea
									value={customSystemPromptInstructions}
									onChange={(event) => setCustomSystemPromptInstructions(event.target.value)}
									placeholder='Example: Prioritize recommendations that improve revenue metric definitions.'
									maxLength={MAX_CUSTOM_SYSTEM_PROMPT_INSTRUCTIONS_LENGTH}
									disabled={setConfig.isPending}
									className='min-h-28 resize-y'
								/>
								<div className='flex items-center justify-between gap-4'>
									<div className='text-xs text-muted-foreground'>
										{customSystemPromptInstructions.length}/
										{MAX_CUSTOM_SYSTEM_PROMPT_INSTRUCTIONS_LENGTH} characters
									</div>
									<Button
										size='sm'
										variant='outline'
										onClick={handleCustomSystemPromptInstructionsSave}
										disabled={setConfig.isPending || !hasCustomSystemPromptInstructionsChanges}
									>
										Save
									</Button>
								</div>
							</>
						)}
					</div>

					<div className='flex items-center justify-between gap-4'>
						<div>
							<div className='text-sm'>YOLO mode</div>
							<div className='text-xs text-muted-foreground'>
								Open pull requests automatically after each run, without human review. Recommendations
								with a PR are marked as applied.
							</div>
						</div>
						<Switch
							checked={yoloEnabled}
							onCheckedChange={handleYoloChange}
							disabled={setConfig.isPending}
						/>
					</div>

					{yoloEnabled && (
						<div className='flex items-center justify-between gap-4'>
							<div>
								<div className='text-sm'>Max pull requests per run</div>
								<div className='text-xs text-muted-foreground'>
									Highest-impact recommendations go first
								</div>
							</div>
							<div className='w-72'>
								<Select
									value={String(maxAutoPrs)}
									onValueChange={handleMaxAutoPrsChange}
									disabled={setConfig.isPending}
								>
									<SelectTrigger className='w-full'>
										<SelectValue />
									</SelectTrigger>
									<SelectContent>
										{MAX_AUTO_PR_OPTIONS.map((n) => (
											<SelectItem key={n} value={String(n)}>
												{n === 1 ? '1 pull request' : `${n} pull requests`}
											</SelectItem>
										))}
									</SelectContent>
								</Select>
							</div>
						</div>
					)}
				</div>
			</SettingsCard>

			<RecommendationRepoCard />
		</div>
	);
}
