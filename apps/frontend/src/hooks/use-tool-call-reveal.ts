import { useEffect, useEffectEvent } from 'react';
import type { StoryQueryGroupItem } from '@/types/ai';
import { isReasoningPart, isStoryStatusPart } from '@/lib/ai';
import { useToolCallRevealRequest } from '@/stores/tool-call-reveal';

/** Expands a collapsed tool call, or a group of them, when one of its tool calls is asked to be revealed. */
export function useExpandOnToolCallReveal(toolCallIds: readonly string[], setExpanded: (expanded: boolean) => void) {
	const request = useToolCallRevealRequest();
	const expandIfTargeted = useEffectEvent((toolCallId: string) => {
		if (toolCallIds.includes(toolCallId)) {
			setExpanded(true);
		}
	});

	useEffect(() => {
		if (request) {
			expandIfTargeted(request.toolCallId);
		}
	}, [request]);
}

export function getToolCallIds(parts: StoryQueryGroupItem[]): string[] {
	return parts.flatMap(getToolCallId);
}

function getToolCallId(part: StoryQueryGroupItem): string[] {
	if (isStoryStatusPart(part)) {
		return [part.part.toolCallId];
	}
	return isReasoningPart(part) ? [] : [part.toolCallId];
}
