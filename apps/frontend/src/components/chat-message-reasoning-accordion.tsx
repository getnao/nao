import { useEffect, useRef, useState } from 'react';
import { Streamdown } from 'streamdown';
import { Conversation, ConversationContent } from './ui/conversation';
import { Expandable } from '@/components/ui/expandable';

interface ReasoningAccordionProps {
	text: string;
	isStreaming: boolean;
}

export const ReasoningAccordion = ({ text, isStreaming }: ReasoningAccordionProps) => {
	const [isExpanded, setIsExpanded] = useState(isStreaming);
	const wasStreamingRef = useRef(isStreaming);

	useEffect(() => {
		if (isStreaming && !wasStreamingRef.current) {
			setIsExpanded(true);
		} else if (!isStreaming && wasStreamingRef.current) {
			setIsExpanded(false);
		}
		wasStreamingRef.current = isStreaming;
	}, [isStreaming]);

	return (
		<Expandable
			title={isStreaming ? 'Thinking' : 'Thought'}
			expanded={isExpanded}
			onExpandedChange={setIsExpanded}
			isLoading={isStreaming}
		>
			<div className='text-muted-foreground text-sm'>
				<Conversation className='p-0'>
					<ConversationContent className='p-0 max-h-[200px]'>
						<Streamdown isAnimating={isStreaming} mode={isStreaming ? 'streaming' : 'static'} cdnUrl={null}>
							{text}
						</Streamdown>
					</ConversationContent>
				</Conversation>
			</div>
		</Expandable>
	);
};
