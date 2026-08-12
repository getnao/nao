import { memo, useEffect, useRef, useState } from 'react';
import { Streamdown } from 'streamdown';
import { Conversation, ConversationContent } from '../ui/conversation';
import { StreamingMarkdown } from '@/components/chat-messages/streaming-markdown';
import { Expandable } from '@/components/ui/expandable';
import { markdownPlugins } from '@/lib/markdown';

interface AssistantReasoningProps {
	text: string;
	isStreaming: boolean;
}

export const AssistantReasoning = memo(({ text, isStreaming }: AssistantReasoningProps) => {
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
			<div className='text-muted-foreground markdown-small'>
				<Conversation className='p-0'>
					<ConversationContent className='p-0 max-h-[200px]'>
						{isStreaming ? (
							<StreamingMarkdown text={text} />
						) : (
							<Streamdown
								isAnimating={isStreaming}
								mode={isStreaming ? 'streaming' : 'static'}
								plugins={markdownPlugins}
							>
								{text}
							</Streamdown>
						)}
					</ConversationContent>
				</Conversation>
			</div>
		</Expandable>
	);
});
