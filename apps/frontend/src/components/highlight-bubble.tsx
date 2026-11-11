import { createPortal } from 'react-dom';
import { MessageCircleQuestionIcon } from 'lucide-react';
import { Button } from './ui/button';

import { useSelection } from '@/contexts/text-selection';
import { useKeyboardShortcuts } from '@/hooks/use-keyboard-shortcuts';
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

	useKeyboardShortcuts({
		'add-selection-to-chat': () => {
			if (selection && isStillSelected(selection.range)) {
				handleAsk();
			}
		},
	});

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
			<Button type='button' variant='outline' size='sm' className='shadow-none' onClick={handleAsk}>
				<span className='flex items-center gap-2'>
					<span className='size-4'>
						<MessageCircleQuestionIcon className='size-4' />
					</span>
					<span>Ask</span>
				</span>
			</Button>
		</div>
	);
}

function isStillSelected(range: Range): boolean {
	const current = window.getSelection();
	if (!current || current.isCollapsed || current.rangeCount === 0) {
		return false;
	}
	const live = current.getRangeAt(0);
	return (
		live.compareBoundaryPoints(Range.START_TO_START, range) === 0 &&
		live.compareBoundaryPoints(Range.END_TO_END, range) === 0
	);
}
