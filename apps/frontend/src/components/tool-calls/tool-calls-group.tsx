import { useState, useMemo, useEffect, memo } from 'react';
import { ToolCall } from './index';
import type { CollapsiblePart } from '@/types/ai';
import { Expandable } from '@/components/ui/expandable';
import { AssistantReasoning } from '@/components/chat-messages/assistant-reasoning';
import { isToolSettled, isReasoningPart } from '@/lib/ai';

interface Props {
	parts: CollapsiblePart[];
	expand: boolean;
}

export const ToolCallsGroup = memo(({ parts, expand }: Props) => {
	const allSettled = useMemo(() => {
		return parts.every(isPartSettled);
	}, [parts]);
	const isLoading = expand || !allSettled;
	const [isExpanded, setIsExpanded] = useState(isLoading);

	useEffect(() => {
		setIsExpanded(isLoading);
	}, [isLoading]);

	const errorCount = useMemo(() => {
		return parts.filter((part) => !isReasoningPart(part) && !!part.errorText).length;
	}, [parts]);

	const title = isLoading
		? `Exploring${errorCount ? ` (${errorCount} error${errorCount > 1 ? 's' : ''})` : ''}`
		: 'Explored';

	return (
		<Expandable
			title={title}
			expanded={isExpanded}
			onExpandedChange={setIsExpanded}
			isLoading={isLoading}
			variant='inline'
			disabled={false}
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

/** Check if a collapsible part is settled (finished running) */
const isPartSettled = (part: CollapsiblePart): boolean => {
	if (isReasoningPart(part)) {
		return part.state !== 'streaming';
	}
	return isToolSettled(part);
};
