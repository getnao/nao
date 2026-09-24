import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import type { ParsedTableBlock } from '@nao/shared/story-segments';

import { DataTableCard } from '@/components/data-table-card';
import { StoryTableEditControls } from '@/components/side-panel/story-table-embed';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { trpc } from '@/main';

type Decision = 'agree' | 'decline';

export function StoryRowReviewTable({
	shareId,
	table,
	data,
	columns,
}: {
	shareId: string;
	table: ParsedTableBlock;
	data: Record<string, unknown>[];
	columns: string[];
}) {
	const queryClient = useQueryClient();
	const reviewKey = table.reviewKey!;
	const rowIds = useMemo(
		() => [
			...new Set(
				data
					.map((row) => row[reviewKey])
					.filter((id) => id != null)
					.map(String),
			),
		],
		[data, reviewKey],
	);
	const reviewInput = { shareId, queryId: table.queryId, rowIds };
	const reviews = useQuery({
		...trpc.storyShare.getRowReviews.queryOptions(reviewInput),
		enabled: rowIds.length > 0,
	});
	const save = useMutation(
		trpc.storyShare.saveRowReview.mutationOptions({
			onSuccess: async () => {
				await queryClient.invalidateQueries({ queryKey: trpc.storyShare.getRowReviews.queryKey(reviewInput) });
				setSelectedRowId(null);
			},
		}),
	);
	const [selectedRowId, setSelectedRowId] = useState<string | null>(null);
	const [decision, setDecision] = useState<Decision | null>(null);
	const [reason, setReason] = useState('');
	const byId = useMemo(() => new Map((reviews.data ?? []).map((review) => [review.rowId, review])), [reviews.data]);
	const rows = useMemo(
		() =>
			data.map((row) => {
				const review = byId.get(String(row[reviewKey]));
				return {
					...row,
					Review: reviews.isError
						? 'Unavailable'
						: reviews.isLoading
							? 'Loading'
							: (review?.decision ?? 'Unreviewed'),
					'Review reason': review?.reason ?? '',
					'Reviewed by': review?.reviewerName ?? '',
					'Reviewed at': review?.updatedAt ?? '',
				};
			}),
		[data, byId, reviewKey, reviews.isError, reviews.isLoading],
	);
	const openReview = (rowId: string) => {
		save.reset();
		const existing = byId.get(rowId);
		setSelectedRowId(rowId);
		setDecision(existing?.decision ?? null);
		setReason(existing?.reason ?? '');
	};
	const canSave = decision === 'agree' || (decision === 'decline' && reason.trim().length > 0);

	return (
		<>
			{reviews.isError && (
				<p role='alert' className='text-sm text-destructive'>
					Could not load saved reviews.
				</p>
			)}
			<DataTableCard
				data={rows}
				columns={[...columns, 'Review', 'Review reason', 'Reviewed by', 'Reviewed at']}
				title={table.title}
				conditionalFormats={table.conditionalFormats}
				headerActions={<StoryTableEditControls table={table} data={data} columns={columns} />}
				renderCell={(row, column) =>
					column === 'Review' ? (
						<Button
							variant='outline'
							size='sm'
							disabled={row[reviewKey] == null || reviews.isLoading || reviews.isError}
							onClick={() => openReview(String(row[reviewKey]))}
						>
							{String(row[column])}
						</Button>
					) : undefined
				}
			/>
			<Dialog open={selectedRowId !== null} onOpenChange={(open) => !open && setSelectedRowId(null)}>
				<DialogContent>
					<DialogTitle>Review row</DialogTitle>
					<DialogDescription>
						{reviewKey}: {selectedRowId}
					</DialogDescription>
					<div className='flex gap-2'>
						<Button
							variant={decision === 'agree' ? 'default' : 'outline'}
							onClick={() => setDecision('agree')}
						>
							Agree
						</Button>
						<Button
							variant={decision === 'decline' ? 'default' : 'outline'}
							onClick={() => setDecision('decline')}
						>
							Decline
						</Button>
					</div>
					{decision === 'decline' && (
						<Textarea
							aria-label='Why do you disagree?'
							value={reason}
							onChange={(event) => setReason(event.target.value)}
							maxLength={1000}
							placeholder='Why do you disagree?'
						/>
					)}
					{save.error && (
						<p role='alert' className='text-sm text-destructive'>
							{save.error.message}
						</p>
					)}
					<DialogFooter>
						<Button
							disabled={!canSave || save.isPending || !selectedRowId}
							onClick={() => {
								if (selectedRowId && decision) {
									save.mutate({
										shareId,
										queryId: table.queryId,
										rowId: selectedRowId,
										decision,
										reason: decision === 'decline' ? reason : undefined,
									});
								}
							}}
						>
							Save review
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</>
	);
}
