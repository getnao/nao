import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import type { TransferRecipient } from '@/components/transfer-ownership-dialog';
import { TransferOwnershipDialog } from '@/components/transfer-ownership-dialog';
import { trpc } from '@/main';

interface TransferAutomationsDialogProps {
	member: TransferRecipient | null;
	onOpenChange: (open: boolean) => void;
}

/** Hands every automation a member owns in the project to another member, e.g. when they leave or are away for long. */
export function TransferAutomationsDialog({ member, onOpenChange }: TransferAutomationsDialogProps) {
	const queryClient = useQueryClient();
	const ownedAutomations = useQuery({
		...trpc.automation.countOwnedByUser.queryOptions({ userId: member?.id ?? '' }),
		enabled: !!member,
	});
	const recipients = useQuery({
		...trpc.project.listTransferRecipients.queryOptions({ fromUserId: member?.id ?? '' }),
		enabled: !!member,
	});
	const transfer = useMutation(
		trpc.automation.transferAllFromUser.mutationOptions({
			onSuccess: () => {
				void queryClient.invalidateQueries({ queryKey: trpc.automation.pathKey() });
				onOpenChange(false);
			},
		}),
	);
	const automationCount = ownedAutomations.data?.count;

	return (
		<TransferOwnershipDialog
			open={!!member}
			onOpenChange={(nextOpen) => {
				transfer.reset();
				onOpenChange(nextOpen);
			}}
			title={`Transfer ${member?.name ?? ''}'s automations`}
			description={
				ownedAutomations.isError
					? 'Their automations could not be counted. Close this dialog and try again.'
					: describeOwnedAutomations(member?.name ?? '', automationCount)
			}
			recipients={recipients.data}
			canTransfer={!!automationCount}
			hasNothingToTransfer={automationCount === 0}
			isPending={transfer.isPending}
			error={recipients.error?.message ?? transfer.error?.message}
			onTransfer={(recipientId) => member && transfer.mutate({ fromUserId: member.id, recipientId })}
		/>
	);
}

function describeOwnedAutomations(memberName: string, automationCount: number | undefined): string {
	if (automationCount === undefined) {
		return 'Counting their automations…';
	}
	if (automationCount === 0) {
		return `${memberName} owns no automations in this project.`;
	}
	const automations = automationCount === 1 ? '1 automation' : `${automationCount} automations`;
	return `${memberName} owns ${automations} in this project. Future runs will use the new owner's access and integrations, and they will see the past runs.`;
}
