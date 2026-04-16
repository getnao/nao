import { useMutation } from '@tanstack/react-query';

import type { SelectionData } from '@/components/highlight-bubble';
import { useSelection } from '@/contexts/text-selection';
import { trpc } from '@/main';

export function useForkSelectionAsk(shareId: string, contentType: 'chat' | 'story') {
	const { selection, addAnchor, openAnchor } = useSelection();

	const forkMutation = useMutation(trpc.chatFork.fork.mutationOptions());

	return (data: SelectionData) => {
		const captured = selection;
		forkMutation.mutate(
			{ shareId, type: contentType, selection: data },
			{
				onSuccess: ({ chatId }) => {
					if (!captured) {
						return;
					}
					addAnchor(chatId, captured.start, captured.end, captured.rect, captured.containerLeft);
					openAnchor(chatId);
				},
			},
		);
	};
}
