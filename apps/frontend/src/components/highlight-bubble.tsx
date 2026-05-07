import { MessageCircle } from 'lucide-react';
import { createPortal } from 'react-dom';

import { Button } from './ui/button';
import { useSelection } from '@/contexts/text-selection';
import { useForkSelectionAsk } from '@/hooks/use-fork-selection-ask';
import { useTrackedBubbleRect } from '@/hooks/use-tracked-bubble-rect';

export interface SelectionData {
	start: number;
	end: number;
	text: string;
	range: Range;
}

export interface HighlightBubbleProps {
	onAsk: (data: SelectionData) => void;
	disabled?: boolean;
}

export function ForkBubble({ shareId, contentType }: { shareId: string; contentType: 'chat' | 'story' }) {
	const handleAsk = useForkSelectionAsk(shareId, contentType);
	return <HighlightBubble onAsk={handleAsk} />;
}

export const HighlightBubble = ({ onAsk, disabled }: HighlightBubbleProps) => {
	const { selection } = useSelection();

	if (!selection || disabled) {
		return null;
	}

	return createPortal(<BubbleContent onAsk={onAsk} />, document.body);
};

function BubbleContent({ onAsk }: { onAsk: (data: SelectionData) => void }) {
	const { selection, clearSelection } = useSelection();
	const position = useTrackedBubbleRect();

	const handleAsk = () => {
		if (!selection) {
			return;
		}
		onAsk({ start: selection.start, end: selection.end, text: selection.text, range: selection.range });
		clearSelection();
		window.getSelection()?.removeAllRanges();
	};

	if (!selection || !position) {
		return null;
	}

	return (
		<div
			style={{
				position: 'fixed',
				left: position.centerX,
				top: position.top,
				transform: 'translateX(-50%) translateY(-100%)',
				zIndex: 50,
			}}
			onMouseDown={(e) => e.stopPropagation()}
		>
			<Button
				type='button'
				onClick={handleAsk}
				className='inline-flex items-center gap-1.5 rounded-lg border border-border bg-popover px-3 py-1.5 text-xs font-medium text-popover-foreground shadow-sm transition-colors hover:bg-accent hover:text-accent-foreground'
			>
				<MessageCircle className='size-3.5' />
				Ask
			</Button>
		</div>
	);
}
