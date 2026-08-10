import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import {
	Check,
	ChevronRight,
	Circle,
	CircleCheck,
	Copy,
	ExternalLink,
	GitMerge,
	GitPullRequest,
	GitPullRequestClosed,
	Loader2,
	MessageCircleX,
	ScrollText,
	ThumbsDown,
	Users,
	Wand2,
	X,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
	CONTEXT_RECOMMENDATION_CATEGORY_LABELS,
	normalizeContextRecommendationCategory,
} from '@nao/shared/context-recommendation';
import type { MouseEvent } from 'react';
import type { inferRouterOutputs } from '@trpc/server';

import type { ContextRecommendationSignalType } from '@nao/backend/context-recommendation';
import type { TrpcRouter } from '@nao/backend/trpc';
import type { RecommendationTab } from '@/components/settings/recommendations-route-search';
import type { ReplayHighlight } from '@/components/settings/usage-route-search';
import { RecommendationDiffPanel } from '@/components/side-panel/recommendation-diff-panel';
import { RecommendationManualFixPanel } from '@/components/side-panel/recommendation-manual-fix-panel';
import { DEFAULT_USAGE_SEARCH } from '@/components/settings/usage-route-search';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { useSidePanel } from '@/contexts/side-panel';
import { useCopyToClipboard } from '@/hooks/use-copy-to-clipboard';
import { useRecommendationCollapsed } from '@/hooks/use-recommendation-collapsed';
import { useTimeAgo } from '@/hooks/use-time-ago';
import { computeLineDiff } from '@/lib/line-diff';
import { RecommendationText } from '@/lib/recommendation-text';
import { cn } from '@/lib/utils';
import { trpc } from '@/main';

type RouterOutputs = inferRouterOutputs<TrpcRouter>;
type Recommendation = RouterOutputs['contextRecommendation']['list'][number];
type RecommendationStatus = 'applied' | 'dismissed';

const CONTEXT_RECOMMENDATION_CATEGORY_BADGE_VARIANT = {
	tool_error: 'bg-red-500/10 text-red-600 dark:text-red-400',
	hallucination: 'bg-blue-500/10 text-blue-600 dark:text-blue-400',
	semantic_missing: 'bg-green-500/10 text-green-600 dark:text-green-400',
	context_bloat: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
	skills: 'bg-purple-500/10 text-purple-600 dark:text-purple-400',
	other: 'bg-gray-500/10 text-gray-600 dark:text-gray-400',
} as const;

interface ChatLink {
	chatId: string;
	targetId?: string;
	highlight?: ReplayHighlight;
}

function replayHighlightFor(
	signalType: ContextRecommendationSignalType | null | undefined,
): ReplayHighlight | undefined {
	if (signalType === 'tool_error') {
		return 'tool-error';
	}
	if (
		signalType === 'downvote_theme' ||
		signalType === 'repeated_correction' ||
		signalType === 'friction' ||
		signalType === 'coverage_gap'
	) {
		return 'feedback';
	}
	return undefined;
}

type InsightLike = {
	signalType: ContextRecommendationSignalType;
	triggerRefs?: { chatId: string; targetId?: string }[];
};

function chatLinks(insights: InsightLike[] | null): ChatLink[] {
	const seen = new Set<string>();
	const links: ChatLink[] = [];
	for (const insight of insights ?? []) {
		const highlight = replayHighlightFor(insight.signalType);
		for (const ref of insight.triggerRefs ?? []) {
			if (!seen.has(ref.chatId)) {
				seen.add(ref.chatId);
				links.push({ chatId: ref.chatId, targetId: ref.targetId, highlight });
			}
		}
	}
	return links;
}

type FeedbackItem = Recommendation['feedbacks'][number];

type CardRow =
	| { kind: 'feedback'; key: string; chatId: string; messageId: string; userName: string; explanation: string | null }
	| { kind: 'chat'; key: string; chatId: string; targetId?: string; highlight?: ReplayHighlight };

function buildRows(links: ChatLink[], feedbacks: FeedbackItem[]): CardRow[] {
	const feedbackRows: CardRow[] = feedbacks.map((f) => ({
		kind: 'feedback',
		key: `fb:${f.messageId}`,
		chatId: f.chatId,
		messageId: f.messageId,
		userName: f.userName,
		explanation: f.explanation,
	}));
	const covered = new Set(feedbacks.map((f) => f.chatId));
	const chatRows: CardRow[] = links
		.filter((link) => !covered.has(link.chatId))
		.map((link) => ({
			kind: 'chat',
			key: `chat:${link.chatId}`,
			chatId: link.chatId,
			targetId: link.targetId,
			highlight: link.highlight,
		}));
	return [...feedbackRows, ...chatRows];
}

function tabForStatus(status: Recommendation['status']): RecommendationTab {
	if (status === 'applied') {
		return 'applied';
	}
	if (status === 'dismissed') {
		return 'dismissed';
	}
	return 'recommendations';
}

function initials(name: string): string {
	const parts = name.trim().split(/\s+/).filter(Boolean);
	if (parts.length === 0) {
		return '?';
	}
	if (parts.length === 1) {
		return parts[0].slice(0, 1).toUpperCase();
	}
	return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

interface RecommendationCardProps {
	recommendation: Recommendation;
	onChangeStatus: (id: string, status: RecommendationStatus) => void;
	isPending: boolean;
	defaultCollapsed?: boolean;
	readOnly?: boolean;
	highlightOpen?: boolean;
	isSelected?: boolean;
	selectionActive?: boolean;
	onSelect?: (id: string, checked: boolean, shiftKey?: boolean) => void;
}

export function RecommendationCard({
	recommendation: rec,
	onChangeStatus,
	isPending,
	defaultCollapsed = false,
	readOnly = false,
	highlightOpen = false,
	isSelected = false,
	selectionActive = false,
	onSelect,
}: RecommendationCardProps) {
	const allLinks = useMemo(() => chatLinks(rec.insights), [rec.insights]);
	const feedbacks = useMemo(() => rec.feedbacks ?? [], [rec.feedbacks]);
	const rows = useMemo(() => buildRows(allLinks, feedbacks), [allLinks, feedbacks]);
	const visibleRows = useMemo(() => rows.slice(0, 5), [rows]);
	const hiddenCount = rows.length - visibleRows.length;
	const metaChatIds = useMemo(() => [...new Set(visibleRows.map((r) => r.chatId))], [visibleRows]);
	const totalChatCount = useMemo(
		() => new Set([...allLinks.map((l) => l.chatId), ...feedbacks.map((f) => f.chatId)]).size,
		[allLinks, feedbacks],
	);
	const queryClient = useQueryClient();
	const sidePanel = useSidePanel();
	const [collapsed, setCollapsed] = useRecommendationCollapsed(rec.id, defaultCollapsed);
	const [chatsExpanded, setChatsExpanded] = useState(false);
	const [isFetchingPrompt, setIsFetchingPrompt] = useState(false);
	const [promptError, setPromptError] = useState<string | null>(null);
	const createdAgo = useTimeAgo(new Date(rec.createdAt).getTime());
	const cardRef = useRef<HTMLDivElement>(null);
	const { isCopied, copy } = useCopyToClipboard();

	useEffect(() => {
		if (!highlightOpen) {
			return;
		}
		setCollapsed(false);
		setChatsExpanded(true);
		const frame = requestAnimationFrame(() => {
			cardRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
		});
		return () => cancelAnimationFrame(frame);
	}, [highlightOpen, setCollapsed]);

	const chatMetadata = useQuery({
		...trpc.contextRecommendation.listRecoTriggerChatMetadata.queryOptions({
			chatIds: metaChatIds,
		}),
		enabled: metaChatIds.length > 0 && !collapsed,
		staleTime: 60_000,
	});

	const distinctUserCount = useMemo(() => {
		const names = new Set<string>();
		for (const meta of chatMetadata.data ?? []) {
			if (meta.userName) {
				names.add(meta.userName);
			}
		}
		for (const feedback of feedbacks) {
			if (feedback.userName) {
				names.add(feedback.userName);
			}
		}
		return names.size;
	}, [chatMetadata.data, feedbacks]);

	const createPr = useMutation(
		trpc.contextRecommendation.createPullRequest.mutationOptions({
			onSuccess: () => {
				queryClient.invalidateQueries({ queryKey: trpc.contextRecommendation.list.queryKey({}) });
			},
		}),
	);

	const prStatus = useQuery({
		...trpc.contextRecommendation.getPrStatus.queryOptions({ id: rec.id }),
		enabled: !!rec.prUrl,
		staleTime: 30_000,
	});

	const edits = useMemo(() => rec.proposedEdits ?? [], [rec.proposedEdits]);
	const hasPatch = rec.fixKind === 'patch' && edits.length > 0;
	const hasManualFix = rec.fixKind === 'manual' && (!!rec.fixGuidance || !!rec.fixPrompt);

	const diffTotals = useMemo(() => {
		if (!hasPatch) {
			return null;
		}
		return edits.reduce(
			(totals, edit) => {
				const diff = computeLineDiff(edit.oldContent, edit.newContent);
				return { additions: totals.additions + diff.additions, deletions: totals.deletions + diff.deletions };
			},
			{ additions: 0, deletions: 0 },
		);
	}, [edits, hasPatch]);

	const handleCopyPrompt = async () => {
		setIsFetchingPrompt(true);
		setPromptError(null);
		try {
			const prompt = await queryClient.fetchQuery(
				trpc.contextRecommendation.getAgentPrompt.queryOptions({ ids: [rec.id] }),
			);
			await copy(prompt);
		} catch (err) {
			setPromptError(err instanceof Error ? err.message : 'Failed to copy prompt');
		} finally {
			setIsFetchingPrompt(false);
		}
	};

	const selectable = !!onSelect && !readOnly;

	const handleCardClick = (event: MouseEvent<HTMLDivElement>) => {
		if (!onSelect || readOnly) {
			return;
		}
		if ((event.target as HTMLElement).closest('button, a')) {
			return;
		}
		if (window.getSelection()?.toString()) {
			return;
		}
		onSelect(rec.id, !isSelected, event.shiftKey);
	};

	return (
		<Card
			ref={cardRef}
			onClick={selectable ? handleCardClick : undefined}
			className={cn(
				'group gap-0 rounded-lg border py-0 bg-background shadow-none',
				selectable && 'cursor-pointer',
				isSelected && 'ring-2 ring-primary',
			)}
		>
			<div className='flex items-top gap-2 px-3 py-3'>
				{onSelect && !readOnly && (
					<span className='flex h-[1lh] shrink-0 items-center pt-0.5'>
						<RecommendationCheckbox
							selected={isSelected}
							visible={isSelected || selectionActive}
							onClick={(e) => {
								e.stopPropagation();
								onSelect(rec.id, !isSelected, e.shiftKey);
							}}
						/>
					</span>
				)}
				<span className='flex h-[1lh] shrink-0 items-center'>
					<button
						type='button'
						onClick={() => setCollapsed((value) => !value)}
						className='flex items-center rounded-full text-muted-foreground hover:text-foreground'
						aria-expanded={!collapsed}
						aria-label={collapsed ? 'Expand recommendation' : 'Collapse recommendation'}
					>
						<ChevronRight className={cn('size-3.5 transition-transform', !collapsed && 'rotate-90')} />
					</button>
				</span>
				<div className='flex min-w-0 flex-1 items-start gap-2'>
					<span className='min-w-0 flex-1 text-md font-bold flex items-start gap-2'>{rec.title}</span>
					<div className='py-1'>
						{collapsed && diffTotals && (
							<span className='flex h-[1lh] shrink-0 items-center gap-1 font-mono text-[11px]'>
								<span className='text-emerald-600 dark:text-emerald-400'>+{diffTotals.additions}</span>
								<span className='text-red-600 dark:text-red-400'>−{diffTotals.deletions}</span>
							</span>
						)}
					</div>
				</div>
				<div className='flex h-[1lh] shrink-0 items-center gap-1'>
					<TooltipProvider delayDuration={150}>
						<Tooltip>
							<TooltipTrigger asChild>
								<Button
									size='icon'
									variant='ghost'
									className={cn(
										'size-6 rounded-full text-muted-foreground hover:text-foreground',
										isFetchingPrompt && 'bg-accent disabled:opacity-100 dark:bg-accent/50',
									)}
									onClick={handleCopyPrompt}
									disabled={isFetchingPrompt}
								>
									{isCopied ? (
										<Check className='size-3.5' />
									) : isFetchingPrompt ? (
										<Loader2 className='size-3.5 animate-spin' />
									) : (
										<Copy className='size-3.5' />
									)}
									<span className='sr-only'>Copy prompt</span>
								</Button>
							</TooltipTrigger>
							<TooltipContent>{isCopied ? 'Copied' : 'Copy prompt'}</TooltipContent>
						</Tooltip>
					</TooltipProvider>
					<Badge
						className={
							CONTEXT_RECOMMENDATION_CATEGORY_BADGE_VARIANT[
								normalizeContextRecommendationCategory(rec.category)
							]
						}
					>
						{CONTEXT_RECOMMENDATION_CATEGORY_LABELS[normalizeContextRecommendationCategory(rec.category)]}
					</Badge>
				</div>
				<div className='flex shrink-0 items-top gap-0.5'>
					{!readOnly && (
						<TooltipProvider delayDuration={150}>
							<Tooltip>
								<TooltipTrigger asChild>
									<Button
										size='icon'
										variant='ghost'
										className='size-6 text-muted-foreground hover:text-destructive rounded-full'
										onClick={() => onChangeStatus(rec.id, 'dismissed')}
										disabled={isPending || rec.status === 'dismissed'}
									>
										<X className='size-3.5' />
										<span className='sr-only'>Dismiss</span>
									</Button>
								</TooltipTrigger>
								<TooltipContent>Dismiss</TooltipContent>
							</Tooltip>
							<Tooltip>
								<TooltipTrigger asChild>
									<Button
										size='icon'
										variant='ghost'
										className='size-6 text-muted-foreground hover:text-emerald-600 dark:hover:text-emerald-400 rounded-full'
										onClick={() => onChangeStatus(rec.id, 'applied')}
										disabled={isPending || rec.status === 'applied'}
									>
										<Check className='size-3.5' />
										<span className='sr-only'>Mark applied</span>
									</Button>
								</TooltipTrigger>
								<TooltipContent>Mark applied</TooltipContent>
							</Tooltip>
						</TooltipProvider>
					)}
				</div>
			</div>
			{promptError && <div className='px-3 pb-2 text-xs text-destructive'>{promptError}</div>}
			<div
				className={cn(
					'grid transition-[grid-template-rows] duration-300 ease-in-out px-3',
					collapsed ? 'grid-rows-[0fr]' : 'grid-rows-[1fr]',
				)}
			>
				<div className='overflow-hidden'>
					<div className='flex flex-col gap-3 px-6 pt-1 pb-3 text-sm'>
						<div className='flex flex-col gap-1.5 leading-relaxed text-foreground'>
							<p>
								<RecommendationText text={rec.summary} />
								{rec.rootCause && (
									<>
										{' '}
										<RecommendationText text={rec.rootCause} />
									</>
								)}
							</p>
						</div>
						{rows.length > 0 && (
							<div className='overflow-hidden'>
								<div className='flex items-center gap-1.5 py-1 text-sm text-muted-foreground'>
									<button
										type='button'
										onClick={() => setChatsExpanded((value) => !value)}
										aria-expanded={chatsExpanded}
										className={cn(
											'flex items-center px-2 py-1 gap-1 rounded-md cursor-pointer border border-transparent',
											!chatsExpanded && 'border-border',
										)}
									>
										<MessageCircleX className='size-3 shrink-0' />
										{totalChatCount}
										<Users className='size-3 shrink-0' />
										{distinctUserCount}
										{feedbacks.length > 0 && (
											<>
												<ThumbsDown className='size-3 shrink-0 text-red-500 dark:text-red-400' />
												{feedbacks.length}
											</>
										)}
									</button>
								</div>
								<div
									className={cn(
										'grid transition-[grid-template-rows] duration-300 ease-in-out',
										chatsExpanded ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]',
									)}
								>
									<div className='overflow-hidden'>
										<div className='divide-y divide-border/50 border-t'>
											{visibleRows.map((row) => {
												const meta = chatMetadata.data?.find((m) => m.chatId === row.chatId);
												const title = meta?.title || row.chatId.slice(0, 8);
												const userName = meta?.userName ?? 'Unknown user';
												return (
													<Link
														key={row.key}
														to='/settings/usage/replay/$chatId'
														params={{ chatId: row.chatId }}
														search={{
															...DEFAULT_USAGE_SEARCH,
															highlight:
																row.kind === 'feedback' ? 'feedback' : row.highlight,
															targetId:
																row.kind === 'feedback' ? row.messageId : row.targetId,
															origin: 'recommendations',
															recoId: rec.id,
															recoTab: tabForStatus(rec.status),
														}}
														className='group/link flex items-center gap-2 px-2 py-1 text-sm transition-colors hover:bg-muted/50'
													>
														<span className='flex size-4 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[10px] font-medium text-primary'>
															{meta?.userName ? initials(meta.userName) : '?'}
														</span>
														<span className='w-20 shrink-0 truncate text-muted-foreground'>
															{userName}
														</span>
														<span className='flex-1 truncate text-foreground group-hover/link:text-primary'>
															{title}
														</span>
														{row.kind === 'feedback' && (
															<>
																<ThumbsDown className='size-3.5 shrink-0 text-red-500 dark:text-red-400' />
																{row.explanation && (
																	<span className='min-w-0 flex-1 truncate italic text-muted-foreground'>
																		&ldquo;{row.explanation}&rdquo;
																	</span>
																)}
															</>
														)}
														<ExternalLink className='size-3 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover/link:opacity-100' />
													</Link>
												);
											})}
											{hiddenCount > 0 && (
												<div className='px-2 py-1 text-[11px] text-muted-foreground'>
													+{hiddenCount} more
												</div>
											)}
										</div>
									</div>
								</div>
							</div>
						)}
					</div>
				</div>
			</div>
			{!collapsed && (
				<div className='flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2 border-t bg-muted/30'>
					<div
						className={cn(
							'flex text-[11px] text-muted-foreground',
							sidePanel.isVisible ? 'flex-col items-start gap-y-0.5' : 'flex-wrap items-center gap-x-1.5',
							!hasManualFix && !hasPatch && 'py-1.5',
						)}
					>
						<TooltipProvider delayDuration={150}>
							<Tooltip>
								<TooltipTrigger asChild>
									<span className='cursor-default'>Detected {createdAgo.humanReadable}</span>
								</TooltipTrigger>
								<TooltipContent>
									{new Date(rec.createdAt).toLocaleString()}
									{rec.llmModelId && <span aria-hidden> · {rec.llmModelId}</span>}
								</TooltipContent>
							</Tooltip>
						</TooltipProvider>
					</div>
					{(hasPatch || hasManualFix) && (
						<div className='flex flex-wrap items-center gap-1.5 sm:ml-auto'>
							{hasPatch && (
								<>
									<Button
										size='sm'
										variant='outline'
										onClick={() =>
											sidePanel.open(<RecommendationDiffPanel title={rec.title} edits={edits} />)
										}
									>
										<ScrollText className='size-3.5' />
										{edits.length} suggested change{edits.length === 1 ? '' : 's'}
										{diffTotals && (
											<span className='ml-1 font-mono text-[11px]'>
												<span className='text-emerald-600 dark:text-emerald-400'>
													+{diffTotals.additions}
												</span>{' '}
												<span className='text-red-600 dark:text-red-400'>
													−{diffTotals.deletions}
												</span>
											</span>
										)}
									</Button>
									{rec.prUrl ? (
										<Button size='sm' variant='outline' asChild>
											<a href={rec.prUrl} target='_blank' rel='noopener noreferrer'>
												<PrStatusIcon state={prStatus.data?.state} />
												{PR_STATUS_LABEL[prStatus.data?.state ?? 'open']}
											</a>
										</Button>
									) : (
										<Button
											size='sm'
											onClick={() => createPr.mutate({ id: rec.id })}
											disabled={createPr.isPending}
											variant='outline'
										>
											{createPr.isPending ? (
												<Loader2 className='size-3.5 animate-spin' />
											) : (
												<GitPullRequest className='size-3.5' />
											)}
											Create PR
										</Button>
									)}
								</>
							)}
							{hasManualFix && (
								<Button
									size='sm'
									variant='outline'
									onClick={() =>
										sidePanel.open(
											<RecommendationManualFixPanel
												title={rec.title}
												guidance={rec.fixGuidance}
												prompt={rec.fixPrompt}
											/>,
										)
									}
								>
									<Wand2 className='size-3.5' />
									How to fix
								</Button>
							)}
						</div>
					)}
					{createPr.error && (
						<span className='basis-full text-xs text-destructive'>{createPr.error.message}</span>
					)}
				</div>
			)}
		</Card>
	);
}

function RecommendationCheckbox({
	selected,
	visible,
	onClick,
}: {
	selected: boolean;
	visible: boolean;
	onClick: (e: MouseEvent<HTMLElement>) => void;
}) {
	return (
		<button
			type='button'
			aria-label={selected ? 'Deselect recommendation' : 'Select recommendation'}
			aria-pressed={selected}
			onClick={onClick}
			className={cn(
				'inline-flex items-center justify-center size-5 transition-all duration-150 cursor-pointer rounded shrink-0',
				'text-muted-foreground hover:text-foreground',
				visible ? 'opacity-100' : 'w-0 opacity-0 overflow-hidden group-hover:w-5 group-hover:opacity-100',
				selected && 'text-primary',
			)}
		>
			{selected ? <CircleCheck className='size-3.5' /> : <Circle className='size-3.5' />}
		</button>
	);
}

type PrState = 'open' | 'closed' | 'merged';

const PR_STATUS_LABEL: Record<PrState, string> = {
	open: 'View PR',
	merged: 'PR merged',
	closed: 'PR closed',
};

function PrStatusIcon({ state }: { state: PrState | undefined }) {
	if (state === 'merged') {
		return <GitMerge className='size-3.5' />;
	}
	if (state === 'closed') {
		return <GitPullRequestClosed className='size-3.5' />;
	}
	return <ExternalLink className='size-3.5' />;
}
