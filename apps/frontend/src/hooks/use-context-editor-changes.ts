import { useEffect, useRef } from 'react';
import {
	getChangedContextPaths,
	isContextEditorFileToolName,
	isContextEditorRecommendationToolName,
	isContextEditorSkillToolName,
} from '@nao/shared/context-editor';
import type { ContextEditorFileChange, ContextRecommendationApplyResult } from '@nao/shared/context-editor';
import type { UIMessage } from '@nao/backend/chat';

import { useAgentMessagesSelector } from '@/contexts/agent.provider';
import { getToolName, haveSameToolCallIds, isToolSettled, isToolUIPart } from '@/lib/ai';

export interface ContextEditorChanges {
	/** The context files the agent changed. */
	paths: string[];
	/** Whether the agent applied, dismissed or reopened a recommendation. */
	hasChangedRecommendations: boolean;
	/** Whether the agent changed a personal skill or handled a request to share one. */
	hasChangedSkills: boolean;
}

interface SettledChange {
	toolCallId: string;
	paths: string[];
	hasChangedRecommendations: boolean;
	hasChangedSkills: boolean;
}

/**
 * Calls `onChange` with what the agent of a Context Hub chat changed since the last call: context files and
 * recommendations. A change reported twice only refreshes the hub twice, so the changes of a resumed conversation are
 * reported once too.
 */
export function useContextEditorChanges(onChange: (changes: ContextEditorChanges) => void) {
	const settledChanges = useAgentMessagesSelector(listSettledChanges, haveSameToolCallIds);
	const reportedToolCallIdsRef = useRef(new Set<string>());
	const onChangeRef = useRef(onChange);
	onChangeRef.current = onChange;

	useEffect(() => {
		const reportedToolCallIds = reportedToolCallIdsRef.current;
		const newChanges = settledChanges.filter((change) => !reportedToolCallIds.has(change.toolCallId));
		if (newChanges.length === 0) {
			return;
		}
		newChanges.forEach((change) => reportedToolCallIds.add(change.toolCallId));
		onChangeRef.current({
			paths: newChanges.flatMap((change) => change.paths),
			hasChangedRecommendations: newChanges.some((change) => change.hasChangedRecommendations),
			hasChangedSkills: newChanges.some((change) => change.hasChangedSkills),
		});
	}, [settledChanges]);
}

function listSettledChanges(messages: UIMessage[]): SettledChange[] {
	return messages.flatMap((message) =>
		message.parts.flatMap((part) => {
			if (!isToolUIPart(part) || !isToolSettled(part) || part.state !== 'output-available') {
				return [];
			}
			const toolName = getToolName(part);
			const hasChangedRecommendations = isContextEditorRecommendationToolName(toolName);
			const hasChangedSkills = isContextEditorSkillToolName(toolName);
			if (!isContextEditorFileToolName(toolName) && !hasChangedRecommendations && !hasChangedSkills) {
				return [];
			}
			const paths = isContextEditorFileToolName(toolName)
				? getChangedContextPaths(
						toolName,
						part.output as ContextEditorFileChange | ContextRecommendationApplyResult,
					)
				: [];
			return [{ toolCallId: part.toolCallId, paths, hasChangedRecommendations, hasChangedSkills }];
		}),
	);
}
