import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import type { TransferRecipient } from '@/components/transfer-ownership-dialog';
import { TransferOwnershipDialog } from '@/components/transfer-ownership-dialog';
import { invalidateStoryOwnershipCaches } from '@/lib/stories-cache';
import { trpc } from '@/main';

interface TransferStoriesDialogProps {
	member: TransferRecipient | null;
	recipients: TransferRecipient[];
	onOpenChange: (open: boolean) => void;
}

/** Hands every story a member owns in the project to another member, e.g. when they leave or are away for long. */
export function TransferStoriesDialog({ member, recipients, onOpenChange }: TransferStoriesDialogProps) {
	const queryClient = useQueryClient();
	const ownedStories = useQuery({
		...trpc.story.countOwnedStories.queryOptions({ userId: member?.id ?? '' }),
		enabled: !!member,
	});
	const transfer = useMutation(
		trpc.story.transferAllFromUser.mutationOptions({
			onSuccess: (result) => {
				invalidateStoryOwnershipCaches(queryClient);
				void queryClient.invalidateQueries({ queryKey: trpc.story.countOwnedStories.queryKey() });
				if (result.failedCount === 0) {
					onOpenChange(false);
				}
			},
		}),
	);
	const storyCount = ownedStories.data?.count;

	return (
		<TransferOwnershipDialog
			open={!!member}
			onOpenChange={(nextOpen) => {
				transfer.reset();
				onOpenChange(nextOpen);
			}}
			title={`Transfer ${member?.name ?? ''}'s stories`}
			description={describeOwnedStories(member?.name ?? '', storyCount)}
			recipients={recipients}
			canTransfer={!!storyCount}
			isPending={transfer.isPending}
			error={transfer.error?.message ?? describeFailedTransfers(transfer.data?.failedCount)}
			onTransfer={(recipientId) => member && transfer.mutate({ fromUserId: member.id, recipientId })}
		/>
	);
}

function describeOwnedStories(memberName: string, storyCount: number | undefined): string {
	if (storyCount === undefined) {
		return 'Counting their stories…';
	}
	if (storyCount === 0) {
		return `${memberName} owns no stories in this project.`;
	}
	const stories = storyCount === 1 ? '1 story' : `${storyCount} stories`;
	return `${memberName} owns ${stories} in this project. The new owner gets each one with its link, sharing and history.`;
}

function describeFailedTransfers(failedCount: number | undefined): string | undefined {
	if (!failedCount) {
		return undefined;
	}
	const stories = failedCount === 1 ? '1 story was' : `${failedCount} stories were`;
	return `${stories} not transferred, usually because someone was editing them. Try again in a moment.`;
}
