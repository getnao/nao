import { useMutation, useQueryClient } from '@tanstack/react-query';

import type { SelectionData } from '@/components/highlight-bubble';
import { useSelection } from '@/contexts/text-selection';
import { trpc } from '@/main';

export function useForkSelectionAsk(shareId: string, contentType: 'chat' | 'story') {
	const { selection, addAnchor, resolveAnchor, removeAnchor, openAnchor } = useSelection();
	const queryClient = useQueryClient();

	const forkMutation = useMutation(trpc.chatFork.fork.mutationOptions());

	const ask = (data: SelectionData) => {
		const captured = selection;
		if (!captured || forkMutation.isPending) {
			return;
		}

		const pendingId = crypto.randomUUID();
		addAnchor(pendingId, captured.start, captured.end, captured.rect, captured.containerLeft, true);
		openAnchor(pendingId);

		forkMutation.mutate(
			{ shareId, type: contentType, selection: data },
			{
				onSuccess: ({ chatId }) => {
					queryClient.invalidateQueries({ queryKey: [['chat', 'listGrouped']] });
					resolveAnchor(pendingId, chatId);
				},
				onError: () => {
					removeAnchor(pendingId);
				},
			},
		);
	};

	return ask;
}
