import { memo, useEffect, useMemo, useState } from 'react';
import { pluralize } from '@nao/shared';
import type { StoryQueryGroupItem } from '@/types/ai';
import type { StoryStatusDisplay } from '@/lib/story-status';
import { Expandable } from '@/components/ui/expandable';
import { ToolCall } from '@/components/tool-calls';
import { StoryStatus } from '@/components/tool-calls/story-status';
import { AssistantReasoning } from '@/components/chat-messages/assistant-reasoning';
import { useChatView } from '@/contexts/chat-view';
import { useAssistantMessage } from '@/contexts/assistant-message';
import { isReasoningPart, isQueryToolPart, isStoryStatusPart } from '@/lib/ai';
import { getStoryStatusDisplay } from '@/lib/story-status';

interface Props {
	parts: StoryQueryGroupItem[];
	isSettled: boolean;
}

export const StoryQueryGroup = memo(({ parts, isSettled }: Props) => {
	const { isSettled: isMessageSettled } = useAssistantMessage();
	const queryCount = useMemo(() => {
		return parts.filter(isQueryToolPart).length;
	}, [parts]);
	const storyDisplays = useMemo(() => {
		return parts.filter(isStoryStatusPart).map(({ part }) => {
			return getStoryStatusDisplay(part, isMessageSettled);
		});
	}, [isMessageSettled, parts]);
	const hasStoryError = storyDisplays.some(hasDisplayError);
	const hasQueryError = parts.some(isFailedQueryItem);
	const isLoading = !isSettled;
	const { expandOnError } = useChatView();
	const shouldStayOpenOnError = expandOnError && (hasStoryError || hasQueryError);
	const [isExpanded, setIsExpanded] = useState(isLoading || shouldStayOpenOnError);

	useEffect(() => {
		setIsExpanded(isLoading || shouldStayOpenOnError);
	}, [isLoading, shouldStayOpenOnError]);

	const storySummary = formatStorySummary(storyDisplays);
	const querySummary = `${isLoading ? 'running' : 'ran'} ${queryCount} ${pluralize('query', queryCount)}`;
	const summaryTitle = `${storySummary} · ${querySummary}`;
	const version = getLatestVersion(storyDisplays);

	return (
		<Expandable
			title={summaryTitle}
			badge={version}
			expanded={isExpanded}
			onExpandedChange={setIsExpanded}
			isLoading={isLoading}
			triggerClassName='text-foreground'
			variant='inline'
		>
			<div className='flex flex-col gap-2 px-3'>
				{parts.map((part, index) => {
					if (isStoryStatusPart(part)) {
						return <StoryStatus key={part.part.toolCallId} toolPart={part.part} />;
					}
					if (isReasoningPart(part)) {
						return (
							<AssistantReasoning key={index} text={part.text} isStreaming={part.state === 'streaming'} />
						);
					}
					return <ToolCall key={part.toolCallId} toolPart={part} />;
				})}
			</div>
		</Expandable>
	);
});

const hasDisplayError = (display: StoryStatusDisplay): boolean => {
	return !!display.error;
};

const isFailedQueryItem = (part: StoryQueryGroupItem): boolean => {
	return !isStoryStatusPart(part) && !isReasoningPart(part) && part.state === 'output-error';
};

const formatStorySummary = (displays: StoryStatusDisplay[]): string => {
	if (displays.length === 1) {
		return displays[0].title;
	}
	return `${displays.length} ${pluralize('story', displays.length)}`;
};

const getLatestVersion = (displays: StoryStatusDisplay[]): string | undefined => {
	for (let index = displays.length - 1; index >= 0; index--) {
		const version = displays[index].version;
		if (version) {
			return version;
		}
	}
	return undefined;
};
