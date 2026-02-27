import { useState, useEffect, memo } from 'react';
import { ToolCall } from './index';
import type { CollapsiblePart } from '@/types/ai';
import { Expandable } from '@/components/ui/expandable';
import { AssistantReasoning } from '@/components/chat-messages/assistant-reasoning';
import { isReasoningPart } from '@/lib/ai';
import { useToolGroupSummaryTitle } from '@/hooks/use-tool-group-summary-title';

interface Props {
	parts: CollapsiblePart[];
	isSettled: boolean;
}

export const ToolCallsGroup = memo(({ parts, isSettled }: Props) => {
	const isLoading = !isSettled;
	const [isExpanded, setIsExpanded] = useState(isLoading);

	useEffect(() => {
		setIsExpanded(isLoading);
	}, [isLoading]);

	const title = useToolGroupSummaryTitle({ parts, isLoading });

	return (
		<Expandable
			title={title}
			expanded={isExpanded}
			onExpandedChange={setIsExpanded}
			isLoading={isLoading}
			variant='inline'
		>
			<div className='flex flex-col gap-2'>
				{parts.map((part, index) => {
					if (isReasoningPart(part)) {
						return (
							<AssistantReasoning key={index} text={part.text} isStreaming={part.state === 'streaming'} />
						);
					}
					return <ToolCall key={index} toolPart={part} />;
				})}
			</div>
		</Expandable>
	);
});
