import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, useSearch } from '@tanstack/react-router';
import { Check, ChevronRight, ExternalLink, Lightbulb, Loader2, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { ContextRecommendationApplyResult } from '@nao/shared/context-editor';

import type { ContextRecommendation } from '@/hooks/use-context-recommendations';
import type { RecommendationFileEdit } from '@/lib/context-hub-recommendations';
import { FileDiffBody } from '@/components/settings/file-diff';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useFileRecommendations } from '@/hooks/use-context-recommendations';
import { invalidateExplorerQueries, invalidateRecommendationQueries } from '@/lib/context-explorer-queries';
import { computeLineDiff } from '@/lib/line-diff';
import { RecommendationText } from '@/lib/recommendation-text';
import { cn } from '@/lib/utils';
import { trpc } from '@/main';

const SAVE_FIRST_MESSAGE = 'Save or discard your edits before applying the change.';
const MAX_UNGROUPED_RECOMMENDATIONS = 3;

type FileRecommendationEntry = { recommendation: ContextRecommendation; edits: RecommendationFileEdit[] };

/**
 * The changes nao recommends for the open file, from what went wrong in real chats: each one can be reviewed as a
 * diff, applied to the user's changes or dismissed.
 */
export function ContextFileRecommendations({ path, isDirty }: { path: string | null; isDirty: boolean }) {
	const fileRecommendations = useFileRecommendations(path);
	const requestedRecommendationId = useSearch({ strict: false }).recommendation;

	if (fileRecommendations.length === 0) {
		return null;
	}

	const isGrouped = fileRecommendations.length > MAX_UNGROUPED_RECOMMENDATIONS;
	const list = (
		<RecommendationList
			fileRecommendations={fileRecommendations}
			requestedRecommendationId={requestedRecommendationId}
			isDirty={isDirty}
			hasSourceLabel={!isGrouped}
		/>
	);

	if (!isGrouped) {
		return <div className='border-b bg-amber-500/5'>{list}</div>;
	}

	return (
		<RecommendationGroup
			key={`${path}:${requestedRecommendationId ?? ''}`}
			count={fileRecommendations.length}
			isInitiallyExpanded={fileRecommendations.some(
				({ recommendation }) => recommendation.id === requestedRecommendationId,
			)}
		>
			{list}
		</RecommendationGroup>
	);
}

/**
 * Folds a long list of recommendations behind one row so they do not push the file out of view. The list stays
 * mounted while folded so Apply feedback survives.
 */
function RecommendationGroup({
	count,
	isInitiallyExpanded,
	children,
}: {
	count: number;
	isInitiallyExpanded: boolean;
	children: React.ReactNode;
}) {
	const [isExpanded, setIsExpanded] = useState(isInitiallyExpanded);

	return (
		<div className='flex flex-col border-b bg-amber-500/5'>
			<button
				type='button'
				onClick={() => setIsExpanded((value) => !value)}
				aria-expanded={isExpanded}
				className='flex cursor-pointer items-center gap-2 px-4 py-2 text-left text-sm'
			>
				<ChevronRight
					className={cn(
						'size-3.5 shrink-0 text-muted-foreground transition-transform',
						isExpanded && 'rotate-90',
					)}
				/>
				<Lightbulb className='size-4 shrink-0 text-amber-500' />
				<span className='font-medium'>nao suggests {count} changes to this file</span>
			</button>
			<div hidden={!isExpanded} className='max-h-[40vh] overflow-y-auto border-t'>
				{children}
			</div>
		</div>
	);
}

function RecommendationList({
	fileRecommendations,
	requestedRecommendationId,
	isDirty,
	hasSourceLabel,
}: {
	fileRecommendations: FileRecommendationEntry[];
	requestedRecommendationId: string | undefined;
	isDirty: boolean;
	hasSourceLabel: boolean;
}) {
	return (
		<div className='flex flex-col divide-y'>
			{putRequestedFirst(fileRecommendations, requestedRecommendationId).map(({ recommendation, edits }) => (
				<FileRecommendation
					key={recommendation.id}
					recommendation={recommendation}
					edits={edits}
					isDirty={isDirty}
					isInitiallyExpanded={recommendation.id === requestedRecommendationId}
					hasSourceLabel={hasSourceLabel}
				/>
			))}
		</div>
	);
}

function FileRecommendation({
	recommendation,
	edits,
	isDirty,
	isInitiallyExpanded,
	hasSourceLabel,
}: {
	recommendation: ContextRecommendation;
	/** Everything Apply writes, the open file first. */
	edits: RecommendationFileEdit[];
	isDirty: boolean;
	isInitiallyExpanded: boolean;
	hasSourceLabel: boolean;
}) {
	const [isExpanded, setIsExpanded] = useState(isInitiallyExpanded);
	const { apply, dismiss, isPending, errorMessage } = useRecommendationActions(recommendation.id);

	return (
		<div className='flex flex-col gap-2 px-4 py-2 text-sm'>
			<div className='flex min-w-0 items-center gap-2'>
				<button
					type='button'
					onClick={() => setIsExpanded((value) => !value)}
					aria-expanded={isExpanded}
					className='flex min-w-0 flex-1 cursor-pointer items-center gap-2 text-left'
				>
					<ChevronRight
						className={cn(
							'size-3.5 shrink-0 text-muted-foreground transition-transform',
							isExpanded && 'rotate-90',
						)}
					/>
					<Lightbulb className='size-4 shrink-0 text-amber-500' />
					{hasSourceLabel && <span className='shrink-0 text-xs text-muted-foreground'>Suggested by nao</span>}
					<span className='truncate font-medium' title={recommendation.title}>
						{recommendation.title}
					</span>
				</button>
				<div className='flex shrink-0 items-center gap-1'>
					<ApplyButton fileCount={edits.length} isDirty={isDirty} isPending={isPending} onApply={apply} />
					<Tooltip>
						<TooltipTrigger asChild>
							<Button
								size='icon-xs'
								variant='ghost'
								className='rounded-full text-muted-foreground hover:text-destructive'
								disabled={isPending}
								onClick={dismiss}
								aria-label='Dismiss'
							>
								<X />
							</Button>
						</TooltipTrigger>
						<TooltipContent>Dismiss: nao stops suggesting it</TooltipContent>
					</Tooltip>
				</div>
			</div>
			{errorMessage && <p className='pl-5.5 text-xs text-destructive'>{errorMessage}</p>}
			{isExpanded && <RecommendationDetails recommendation={recommendation} edits={edits} />}
		</div>
	);
}

function ApplyButton({
	fileCount,
	isDirty,
	isPending,
	onApply,
}: {
	fileCount: number;
	isDirty: boolean;
	isPending: boolean;
	onApply: () => void;
}) {
	const button = (
		<Button size='sm' variant='outline' disabled={isDirty || isPending} onClick={onApply}>
			{isPending ? <Loader2 className='animate-spin' /> : <Check />}
			{fileCount > 1 ? `Apply to ${fileCount} files` : 'Apply'}
		</Button>
	);
	if (!isDirty) {
		return button;
	}
	return (
		<Tooltip>
			<TooltipTrigger asChild>
				<span tabIndex={0}>{button}</span>
			</TooltipTrigger>
			<TooltipContent>{SAVE_FIRST_MESSAGE}</TooltipContent>
		</Tooltip>
	);
}

function RecommendationDetails({
	recommendation,
	edits,
}: {
	recommendation: ContextRecommendation;
	edits: RecommendationFileEdit[];
}) {
	return (
		<div className='flex flex-col gap-2 pl-5.5'>
			<p className='leading-relaxed text-muted-foreground'>
				<RecommendationText text={recommendation.summary} />
			</p>
			{edits.map((edit) => (
				<EditDiff key={edit.path} edit={edit} hasPathHeader={edits.length > 1} />
			))}
			<Link
				to='/settings/recommendations'
				search={{ tab: 'recommendations', openChats: undefined }}
				className='flex w-fit items-center gap-1 text-xs text-muted-foreground hover:text-foreground'
			>
				See the chats behind it
				<ExternalLink className='size-3' />
			</Link>
		</div>
	);
}

function EditDiff({ edit, hasPathHeader }: { edit: RecommendationFileEdit; hasPathHeader: boolean }) {
	const diff = useMemo(() => computeLineDiff(edit.oldContent, edit.newContent), [edit]);

	return (
		<div className='overflow-hidden rounded-md border bg-background'>
			{hasPathHeader && (
				<div className='flex items-center gap-2 border-b bg-muted/40 px-3 py-1.5 font-mono text-xs'>
					<span className='truncate'>{edit.path}</span>
					{edit.kind === 'create' && <span className='shrink-0 text-emerald-600'>new file</span>}
				</div>
			)}
			<div className='max-h-80 overflow-auto'>
				<FileDiffBody lines={diff.lines} />
			</div>
		</div>
	);
}

function useRecommendationActions(recommendationId: string) {
	const queryClient = useQueryClient();
	const [conflictMessage, setConflictMessage] = useState<string | null>(null);
	const refresh = async (result?: ContextRecommendationApplyResult) => {
		setConflictMessage(result ? describeConflicts(result) : null);
		await Promise.all([invalidateRecommendationQueries(queryClient), invalidateExplorerQueries(queryClient)]);
	};
	const applyMutation = useMutation(
		trpc.contextRecommendation.applyToChanges.mutationOptions({ onSuccess: (result) => refresh(result) }),
	);
	const dismissMutation = useMutation(
		trpc.contextRecommendation.setStatus.mutationOptions({ onSuccess: () => refresh() }),
	);
	const error = applyMutation.error ?? dismissMutation.error;

	return {
		apply: () => applyMutation.mutate({ id: recommendationId }),
		dismiss: () => dismissMutation.mutate({ id: recommendationId, status: 'dismissed' }),
		isPending: applyMutation.isPending || dismissMutation.isPending,
		errorMessage: error?.message ?? conflictMessage,
	};
}

function describeConflicts(result: ContextRecommendationApplyResult): string | null {
	if (result.conflicts.length === 0) {
		return null;
	}
	const reasons = result.conflicts.map((conflict) => `${conflict.path}: ${conflict.reason}`).join(' ');
	return `Some of the change could not be applied. ${reasons} Ask nao in the chat to apply it.`;
}

function putRequestedFirst(
	fileRecommendations: FileRecommendationEntry[],
	requestedRecommendationId: string | undefined,
): FileRecommendationEntry[] {
	const requested = fileRecommendations.filter(
		({ recommendation }) => recommendation.id === requestedRecommendationId,
	);
	const others = fileRecommendations.filter(({ recommendation }) => recommendation.id !== requestedRecommendationId);
	return [...requested, ...others];
}
