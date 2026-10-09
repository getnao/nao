import { memo, useEffect, useMemo, useState } from 'react';
import { pluralize } from '@nao/shared';
import type { StoryQueryGroupItem } from '@/types/ai';
import { Expandable } from '@/components/ui/expandable';
import { ToolCall } from '@/components/tool-calls';
import { getStoryStatusDisplay, StoryStatus } from '@/components/tool-calls/story-status';
import { AssistantReasoning } from '@/components/chat-messages/assistant-reasoning';
import { useChatView } from '@/contexts/chat-view';
import { useAssistantMessage } from '@/contexts/assistant-message';
import { isReasoningPart, isQueryToolPart, isStoryStatusPart, isToolSettled } from '@/lib/ai';

interface Props {
	parts: StoryQueryGroupItem[];
	isSettled: boolean;
}

export const StoryQueryGroup = memo(({ parts, isSettled }: Props) => {
	const { isSettled: isMessageSettled } = useAssistantMessage();
	const storyStatuses = useMemo(() => parts.filter(isStoryStatusPart), [parts]);
	const queryCount = useMemo(() => parts.filter(isQueryToolPart).length, [parts]);
	const storyDisplays = useMemo(
		() => storyStatuses.map(({ part }) => getStoryStatusDisplay(part, isMessageSettled || isToolSettled(part))),
		[isMessageSettled, storyStatuses],
	);
	const hasStoryError = storyDisplays.some((display) => !!display.error);
	const hasQueryError = parts.some(
		(part) => !isStoryStatusPart(part) && !isReasoningPart(part) && part.state === 'output-error',
	);
	const isLoading = !isSettled;
	const { expandOnError } = useChatView();
	const shouldStayOpenOnError = expandOnError && (hasStoryError || hasQueryError);
	const [isExpanded, setIsExpanded] = useState(isLoading || shouldStayOpenOnError);

	useEffect(() => {
		setIsExpanded(isLoading || shouldStayOpenOnError);
	}, [isLoading, shouldStayOpenOnError]);

	const storySummary = formatStorySummary(storyDisplays.map((display) => display.title));
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
						return <StoryStatus key={part.part.toolCallId} toolPart={part.part} withReplayTarget={false} />;
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

const formatStorySummary = (titles: string[]): string => {
	if (titles.length === 1) {
		return titles[0];
	}
	return `${titles.length} ${pluralize('story', titles.length)}`;
};

const getLatestVersion = (displays: { version: string | undefined }[]): string | undefined => {
	for (let index = displays.length - 1; index >= 0; index--) {
		const version = displays[index].version;
		if (version) {
			return version;
		}
	}
	return undefined;
};
