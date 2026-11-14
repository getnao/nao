import { useEffect, useRef } from 'react';
import { isContextEditorFileToolName } from '@nao/shared/context-editor';
import type { ContextEditorFileChange } from '@nao/shared/context-editor';
import type { UIMessage } from '@nao/backend/chat';

import { useAgentMessages } from '@/contexts/agent.provider';
import { getToolName, isToolSettled, isToolUIPart } from '@/lib/ai';

interface SettledFileChange extends ContextEditorFileChange {
	toolCallId: string;
}

/**
 * Calls `onChange` with the context files the agent of a Context Hub chat changed since the last call.
 * A change reported twice only refreshes the hub twice, so the changes of a resumed conversation are reported once too.
 */
export function useContextEditorFileChanges(onChange: (paths: string[]) => void) {
	const messages = useAgentMessages();
	const reportedToolCallIdsRef = useRef(new Set<string>());
	const onChangeRef = useRef(onChange);
	onChangeRef.current = onChange;

	useEffect(() => {
		const reportedToolCallIds = reportedToolCallIdsRef.current;
		const newChanges = listSettledFileChanges(messages).filter(
			(change) => !reportedToolCallIds.has(change.toolCallId),
		);
		if (newChanges.length === 0) {
			return;
		}
		newChanges.forEach((change) => reportedToolCallIds.add(change.toolCallId));
		onChangeRef.current(newChanges.map((change) => change.path));
	}, [messages]);
}

function listSettledFileChanges(messages: UIMessage[]): SettledFileChange[] {
	return messages.flatMap((message) =>
		message.parts.flatMap((part) => {
			if (!isToolUIPart(part) || !isContextEditorFileToolName(getToolName(part))) {
				return [];
			}
			if (!isToolSettled(part) || part.state !== 'output-available') {
				return [];
			}
			const output = part.output as ContextEditorFileChange;
			return [{ toolCallId: part.toolCallId, path: output.path }];
		}),
	);
}
