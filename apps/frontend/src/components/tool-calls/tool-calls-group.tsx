import { useState, useEffect, memo, useMemo } from 'react';
import { McpToolCallsSubGroup } from './mcp-sub-group';
import { ToolCall } from './index';
import type { GroupablePart } from '@/types/ai';
import { Expandable } from '@/components/ui/expandable';
import { AssistantReasoning } from '@/components/chat-messages/assistant-reasoning';
import { useChatView } from '@/contexts/chat-view';
import { ToolGroupProvider } from '@/contexts/tool-group';
import { isReasoningPart } from '@/lib/ai';
import { groupMcpToolCalls } from '@/lib/mcp';
import { useToolGroupSummaryTitle } from '@/hooks/use-tool-group-summary-title';

interface Props {
	parts: GroupablePart[];
	isSettled: boolean;
}

export const ToolCallsGroup = memo(({ parts, isSettled }: Props) => {
	const isLoading = !isSettled;
	const hasError = parts.some((p) => !isReasoningPart(p) && p.state === 'output-error');
	const { expandOnError } = useChatView();
	const [isExpanded, setIsExpanded] = useState(isLoading || (expandOnError && hasError));

	useEffect(() => {
		if (isLoading || (expandOnError && hasError)) {
			setIsExpanded(true);
		}
	}, [isLoading, expandOnError, hasError]);

	const title = useToolGroupSummaryTitle({ parts, isLoading });
	const groupedParts = useMemo(() => groupMcpToolCalls(parts), [parts]);

	return (
		<Expandable
			title={title}
			expanded={isExpanded}
			onExpandedChange={setIsExpanded}
			isLoading={isLoading}
			variant='inline'
		>
			<ToolGroupProvider>
				<div className='flex flex-col gap-2'>
					{groupedParts.map((part, index) => {
						if (part.type === 'mcp-sub-group') {
							return <McpToolCallsSubGroup key={part.id} group={part} isSettled={isSettled} />;
						}
						if (isReasoningPart(part)) {
							return (
								<AssistantReasoning
									key={index}
									text={part.text}
									isStreaming={part.state === 'streaming'}
								/>
							);
						}
						return <ToolCall key={index} toolPart={part} />;
					})}
				</div>
			</ToolGroupProvider>
		</Expandable>
	);
});
