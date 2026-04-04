import { useRef } from 'react';
import { MessageCircle } from 'lucide-react';
import { createPortal } from 'react-dom';
import { useMutation } from '@tanstack/react-query';

import { Button } from './ui/button';
import { Spinner } from './ui/spinner';
import { useSelection } from '@/contexts/text-selection';
import { trpc } from '@/main';

export interface HighlightBubbleProps {
	shareId: string;
	contentType: 'chat' | 'story';
}

export const HighlightBubble = ({ shareId, contentType }: HighlightBubbleProps) => {
	const { selection } = useSelection();

	if (!selection) {
		return null;
	}

	return createPortal(<BubbleContent shareId={shareId} contentType={contentType} />, document.body);
};

function BubbleContent({ shareId, contentType }: { shareId: string; contentType: 'chat' | 'story' }) {
	const { selection, clearSelection, addAnchor, openAnchor } = useSelection();
	const capturedSelection = useRef(selection);

	const forkMutation = useMutation(
		trpc.chatFork.fork.mutationOptions({
			onSuccess: ({ chatId }) => {
				const sel = capturedSelection.current;
				if (!sel) {
					return;
				}
				addAnchor(chatId, sel.start, sel.end, sel.rect, sel.containerLeft);
				openAnchor(chatId);
				clearSelection();
				window.getSelection()?.removeAllRanges();
			},
		}),
	);

	const handleAsk = () => {
		if (!selection) {
			return;
		}
		capturedSelection.current = selection;
		const sel = { start: selection.start, end: selection.end, text: selection.text };
		forkMutation.mutate({ shareId, type: contentType, selection: sel });
	};

	if (!selection) {
		return null;
	}

	const centerX = selection.rect.left + selection.rect.width / 2;
	const top = selection.rect.top - 6;

	return (
		<div
			style={{
				position: 'fixed',
				left: centerX,
				top,
				transform: 'translateX(-50%) translateY(-100%)',
				zIndex: 50,
			}}
			onMouseDown={(e) => e.stopPropagation()}
		>
			<Button
				type='button'
				onClick={handleAsk}
				disabled={forkMutation.isPending}
				className='inline-flex items-center gap-1.5 rounded-lg border border-border bg-popover px-3 py-1.5 text-xs font-medium text-popover-foreground shadow-sm transition-colors hover:bg-accent hover:text-accent-foreground'
			>
				{forkMutation.isPending ? <Spinner className='size-3.5' /> : <MessageCircle className='size-3.5' />}
				Ask
			</Button>
		</div>
	);
}
