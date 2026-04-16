import { useRef } from 'react';
import { useMutation } from '@tanstack/react-query';

import type { SelectionData } from '@/components/highlight-bubble';
import type { SelectionState } from '@/contexts/text-selection';
import { useSelection } from '@/contexts/text-selection';
import { trpc } from '@/main';

export function useForkSelectionAsk(shareId: string, contentType: 'chat' | 'story') {
	const { selection, addAnchor, openAnchor } = useSelection();
	const capturedRef = useRef<SelectionState | null>(null);

	const forkMutation = useMutation(
		trpc.chatFork.fork.mutationOptions({
			onSuccess: ({ chatId }) => {
				const sel = capturedRef.current;
				if (!sel) {
					return;
				}
				addAnchor(chatId, sel.start, sel.end, sel.rect, sel.containerLeft);
				openAnchor(chatId);
			},
		}),
	);

	return (data: SelectionData) => {
		capturedRef.current = selection;
		forkMutation.mutate({ shareId, type: contentType, selection: data });
	};
}
