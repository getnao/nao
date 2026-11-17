import { useEffect, useRef } from 'react';
import {
	getChangedContextPaths,
	isContextEditorFileToolName,
	isContextEditorRecommendationToolName,
} from '@nao/shared/context-editor';
import type { ContextEditorFileChange, ContextRecommendationApplyResult } from '@nao/shared/context-editor';
import type { UIMessage } from '@nao/backend/chat';

import { useAgentMessages } from '@/contexts/agent.provider';
import { getToolName, isToolSettled, isToolUIPart } from '@/lib/ai';

export interface ContextEditorChanges {
	/** The context files the agent changed. */
	paths: string[];
	/** Whether the agent applied, dismissed or reopened a recommendation. */
	hasChangedRecommendations: boolean;
}

interface SettledChange {
	toolCallId: string;
	paths: string[];
	hasChangedRecommendations: boolean;
}

/**
 * Calls `onChange` with what the agent of a Context Hub chat changed since the last call: context files and
 * recommendations. A change reported twice only refreshes the hub twice, so the changes of a resumed conversation are
 * reported once too.
 */
export function useContextEditorChanges(onChange: (changes: ContextEditorChanges) => void) {
	const messages = useAgentMessages();
	const reportedToolCallIdsRef = useRef(new Set<string>());
	const onChangeRef = useRef(onChange);
	onChangeRef.current = onChange;

	useEffect(() => {
		const reportedToolCallIds = reportedToolCallIdsRef.current;
		const newChanges = listSettledChanges(messages).filter((change) => !reportedToolCallIds.has(change.toolCallId));
		if (newChanges.length === 0) {
			return;
		}
		newChanges.forEach((change) => reportedToolCallIds.add(change.toolCallId));
		onChangeRef.current({
			paths: newChanges.flatMap((change) => change.paths),
			hasChangedRecommendations: newChanges.some((change) => change.hasChangedRecommendations),
		});
	}, [messages]);
}

function listSettledChanges(messages: UIMessage[]): SettledChange[] {
	return messages.flatMap((message) =>
		message.parts.flatMap((part) => {
			if (!isToolUIPart(part) || !isToolSettled(part) || part.state !== 'output-available') {
				return [];
			}
			const toolName = getToolName(part);
			const hasChangedRecommendations = isContextEditorRecommendationToolName(toolName);
			if (!isContextEditorFileToolName(toolName) && !hasChangedRecommendations) {
				return [];
			}
			const paths = isContextEditorFileToolName(toolName)
				? getChangedContextPaths(
						toolName,
						part.output as ContextEditorFileChange | ContextRecommendationApplyResult,
					)
				: [];
			return [{ toolCallId: part.toolCallId, paths, hasChangedRecommendations }];
		}),
	);
}
