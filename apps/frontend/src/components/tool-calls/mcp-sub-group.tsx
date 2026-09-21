import { useEffect, useState } from 'react';
import { pluralize } from '@nao/shared';
import { McpTitle } from './mcp-title';
import { ToolCall } from './index';
import type { GroupablePart, McpSubGroupPart } from '@/types/ai';
import { Expandable } from '@/components/ui/expandable';
import { AssistantReasoning } from '@/components/chat-messages/assistant-reasoning';
import { useChatView } from '@/contexts/chat-view';
import { isToolSettled, isReasoningPart } from '@/lib/ai';
import { isMcpCallPart } from '@/lib/mcp';

export const McpToolCallsSubGroup = ({ group, isSettled }: { group: McpSubGroupPart; isSettled: boolean }) => {
	const isLoading = !isSettled && group.parts.some((part) => !isReasoningPart(part) && !isToolSettled(part));
	const hasError = group.parts.some((part) => !isReasoningPart(part) && part.state === 'output-error');
	const { expandOnError } = useChatView();
	const [isExpanded, setIsExpanded] = useState(isLoading || (expandOnError && hasError));

	useEffect(() => {
		if (isLoading || (expandOnError && hasError)) {
			setIsExpanded(true);
		}
	}, [isLoading, expandOnError, hasError]);

	const hasMcpCall = group.parts.some(isMcpCallPart);
	const titleText = getTitleText({
		server: group.server,
		isLoading,
		hasMcpCall,
		errorCount: getErrorCount(group.parts),
	});
	const badge = getMcpCallBadge(group.parts);

	return (
		<Expandable
			title={<McpTitle server={group.server}>{titleText}</McpTitle>}
			badge={badge}
			expanded={isExpanded}
			onExpandedChange={setIsExpanded}
			isLoading={isLoading}
			variant='inline'
		>
			<div className='flex flex-col gap-2'>
				{group.parts.map((part, index) => {
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
};

const getTitleText = ({
	server,
	isLoading,
	hasMcpCall,
	errorCount,
}: {
	server: string;
	isLoading: boolean;
	hasMcpCall: boolean;
	errorCount: number;
}) => {
	const title = hasMcpCall
		? `${isLoading ? 'Using' : 'Used'} ${server} MCP`
		: `${isLoading ? 'Exploring' : 'Explored'} ${server} MCP tools`;

	if (!errorCount) {
		return title;
	}
	return `${title} (${errorCount} ${pluralize('error', errorCount)})`;
};

const getErrorCount = (parts: GroupablePart[]) => {
	return parts.filter((part) => !isReasoningPart(part) && !!part.errorText).length;
};

const getMcpCallBadge = (parts: GroupablePart[]): string | undefined => {
	const counts = new Map<string, number>();

	for (const part of parts) {
		if (!isMcpCallPart(part)) {
			continue;
		}
		const tool = (part as { input?: { tool?: string } }).input?.tool;
		if (tool) {
			counts.set(tool, (counts.get(tool) ?? 0) + 1);
		}
	}

	if (counts.size === 0) {
		return undefined;
	}

	return [...counts.entries()].map(([tool, count]) => (count === 1 ? tool : `${count}× ${tool}`)).join(', ');
};
