import { MessageCircle } from 'lucide-react';
import { createPortal } from 'react-dom';

import { Button } from './ui/button';
import { useSelection } from '@/contexts/selection';

export const HighlightBubble = () => {
	const { selection } = useSelection();

	if (!selection) {
		return null;
	}

	return createPortal(<BubbleContent rect={selection.rect} />, document.body);
};

function BubbleContent({ rect }: { rect: DOMRect }) {
	const { openAnchorFromSelection } = useSelection();

	const centerX = rect.left + rect.width / 2;
	const top = rect.top - 6;

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
				onClick={openAnchorFromSelection}
				className='inline-flex items-center gap-1.5 rounded-lg border border-border bg-popover px-3 py-1.5 text-xs font-medium text-popover-foreground shadow-sm transition-colors hover:bg-accent hover:text-accent-foreground'
			>
				<MessageCircle className='size-3.5' />
				Ask
			</Button>
		</div>
	);
}
