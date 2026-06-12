import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import {
	Check,
	ChevronRight,
	ExternalLink,
	GitMerge,
	GitPullRequest,
	GitPullRequestClosed,
	Loader2,
	MoreHorizontal,
	ScrollText,
	Wand2,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { pluralize } from '@nao/shared';
import type { inferRouterOutputs } from '@trpc/server';

import type { TrpcRouter } from '@nao/backend/trpc';
import { RecommendationDiffPanel } from '@/components/side-panel/recommendation-diff-panel';
import { RecommendationManualFixPanel } from '@/components/side-panel/recommendation-manual-fix-panel';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { useSidePanel } from '@/contexts/side-panel';
import { useRecommendationCollapsed } from '@/hooks/use-recommendation-collapsed';
import { computeLineDiff } from '@/lib/line-diff';
import { SEVERITY_BADGE_VARIANT } from '@/lib/recommendation-severity';
import { cn } from '@/lib/utils';
import { trpc } from '@/main';

type RouterOutputs = inferRouterOutputs<TrpcRouter>;
type Recommendation = RouterOutputs['contextRecommendation']['list'][number];
type RecommendationStatus = 'acknowledged' | 'snoozed' | 'applied' | 'dismissed';

const STATUS_LABEL = {
	open: 'Open',
	acknowledged: 'Acknowledged',
	snoozed: 'Snoozed',
	applied: 'Applied',
	dismissed: 'Dismissed',
} as const;

function exampleChatIds(insights: { exampleChatIds?: string[] }[] | null): string[] {
	const ids = new Set<string>();
	for (const insight of insights ?? []) {
		for (const id of insight.exampleChatIds ?? []) {
			ids.add(id);
		}
	}
	return [...ids];
}

interface RecommendationCardProps {
	recommendation: Recommendation;
	onChangeStatus: (id: string, status: RecommendationStatus) => void;
	isPending: boolean;
	defaultCollapsed?: boolean;
}

export function RecommendationCard({
	recommendation: rec,
	onChangeStatus,
	isPending,
	defaultCollapsed = false,
}: RecommendationCardProps) {
	const chatIds = exampleChatIds(rec.insights);
	const queryClient = useQueryClient();
	const sidePanel = useSidePanel();
	const [collapsed, setCollapsed] = useRecommendationCollapsed(rec.id, defaultCollapsed);
	const [expanded, setExpanded] = useState(false);

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

	return (
		<Card className='gap-0 py-3'>
			<CardHeader>
				<div className='flex items-start gap-2'>
					<button
						type='button'
						onClick={() => setCollapsed((value) => !value)}
						className='flex flex-1 flex-wrap items-center gap-2 text-left'
						aria-expanded={!collapsed}
					>
						<ChevronRight
							className={cn(
								'size-4 shrink-0 text-muted-foreground transition-transform',
								!collapsed && 'rotate-90',
							)}
						/>
						<Badge variant={SEVERITY_BADGE_VARIANT[rec.severity]}>{rec.severity}</Badge>
						{!collapsed && <Badge variant='outline'>{STATUS_LABEL[rec.status]}</Badge>}
						{collapsed && rec.prUrl && <PrStatusBadge state={prStatus.data?.state} />}
						{collapsed && diffTotals && (
							<span className='flex items-center gap-1.5 font-mono text-[11px]'>
								<span className='text-emerald-600 dark:text-emerald-400'>+{diffTotals.additions}</span>
								<span className='text-red-600 dark:text-red-400'>-{diffTotals.deletions}</span>
							</span>
						)}
						<CardTitle className='text-sm'>{rec.title}</CardTitle>
					</button>
					<div className='flex shrink-0 items-center gap-1'>
						<TooltipProvider delayDuration={150}>
							<Tooltip>
								<TooltipTrigger asChild>
									<Button
										size='icon'
										variant='ghost'
										className='size-7'
										onClick={() => onChangeStatus(rec.id, 'applied')}
										disabled={isPending || rec.status === 'applied'}
									>
										<Check className='size-4' />
										<span className='sr-only'>Mark applied</span>
									</Button>
								</TooltipTrigger>
								<TooltipContent>Mark applied</TooltipContent>
							</Tooltip>
						</TooltipProvider>
						<DropdownMenu>
							<DropdownMenuTrigger asChild>
								<Button size='icon' variant='ghost' className='size-7' disabled={isPending}>
									<MoreHorizontal className='size-4' />
									<span className='sr-only'>More actions</span>
								</Button>
							</DropdownMenuTrigger>
							<DropdownMenuContent align='end'>
								<DropdownMenuItem onClick={() => onChangeStatus(rec.id, 'acknowledged')}>
									Acknowledge
								</DropdownMenuItem>
								<DropdownMenuItem onClick={() => onChangeStatus(rec.id, 'snoozed')}>
									Snooze 30d
								</DropdownMenuItem>
								<DropdownMenuItem onClick={() => onChangeStatus(rec.id, 'applied')}>
									Mark applied
								</DropdownMenuItem>
								<DropdownMenuSeparator />
								<DropdownMenuItem
									variant='destructive'
									onClick={() => onChangeStatus(rec.id, 'dismissed')}
								>
									Dismiss
								</DropdownMenuItem>
							</DropdownMenuContent>
						</DropdownMenu>
					</div>
				</div>
			</CardHeader>
			<div
				className={cn(
					'grid transition-[grid-template-rows] duration-300 ease-in-out',
					collapsed ? 'grid-rows-[0fr]' : 'grid-rows-[1fr]',
				)}
			>
				<div className='overflow-hidden'>
					<CardContent className='flex flex-col gap-2 pt-2 text-sm'>
						<p className={cn('text-muted-foreground', !expanded && 'line-clamp-2')}>{rec.summary}</p>
						{expanded && (
							<p>
								<span className='font-medium'>Fix:</span> {rec.suggestedAction}
							</p>
						)}
						<button
							type='button'
							onClick={() => setExpanded((value) => !value)}
							className='self-start text-xs font-medium text-primary underline-offset-4 hover:underline'
						>
							{expanded ? 'Show less' : 'Show more'}
						</button>
						<div className='flex flex-wrap items-center gap-x-1 text-xs text-muted-foreground'>
							{rec.llmModelId && <span>Proposed by {rec.llmModelId}</span>}
							{rec.llmModelId && chatIds.length > 0 && <span aria-hidden>•</span>}
							{chatIds.length > 0 && (
								<span className='flex flex-wrap items-center gap-2 text-xs'>
									<span className='text-muted-foreground'>
										Found in {chatIds.length} {pluralize('chat', chatIds.length)}:
									</span>
									{chatIds.slice(0, 5).map((chatId) => (
										<Link
											key={chatId}
											to='/$chatId'
											params={{ chatId }}
											className='text-primary underline-offset-4 hover:underline'
										>
											{chatId.slice(0, 8)}
										</Link>
									))}
								</span>
							)}
						</div>
						{(hasPatch || hasManualFix) && (
							<div className='flex flex-wrap items-center gap-2 rounded-md border border-dashed bg-muted/30 p-2'>
								{hasPatch && (
									<>
										<span className='text-xs font-medium text-muted-foreground'>
											nao drafted {edits.length} file change{edits.length === 1 ? '' : 's'}
										</span>
										<Button
											size='sm'
											variant='outline'
											onClick={() =>
												sidePanel.open(
													<RecommendationDiffPanel title={rec.title} edits={edits} />,
												)
											}
										>
											<ScrollText className='size-3.5' />
											Show diff
										</Button>
										{rec.prUrl ? (
											<>
												<Button size='sm' variant='outline' asChild>
													<a href={rec.prUrl} target='_blank' rel='noopener noreferrer'>
														<ExternalLink className='size-3.5' />
														View PR
													</a>
												</Button>
												<PrStatusBadge state={prStatus.data?.state} />
											</>
										) : (
											<Button
												size='sm'
												onClick={() => createPr.mutate({ id: rec.id })}
												disabled={createPr.isPending}
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
									<>
										<span className='text-xs font-medium text-muted-foreground'>
											Needs a manual fix (auto-generated file)
										</span>
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
									</>
								)}
								{createPr.error && (
									<span className='w-full text-xs text-destructive'>{createPr.error.message}</span>
								)}
							</div>
						)}
					</CardContent>
				</div>
			</div>
		</Card>
	);
}

type PrState = 'open' | 'closed' | 'merged';

function PrStatusBadge({ state }: { state: PrState | undefined }) {
	if (!state) {
		return null;
	}
	if (state === 'merged') {
		return (
			<Badge className='bg-purple-500/15 text-purple-600 dark:text-purple-400'>
				<GitMerge className='size-3' />
				Merged
			</Badge>
		);
	}
	if (state === 'closed') {
		return (
			<Badge className='bg-red-500/15 text-red-600 dark:text-red-400'>
				<GitPullRequestClosed className='size-3' />
				Closed
			</Badge>
		);
	}
	return (
		<Badge className='bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'>
			<GitPullRequest className='size-3' />
			Open
		</Badge>
	);
}
