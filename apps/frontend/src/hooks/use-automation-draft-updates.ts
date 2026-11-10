import { useEffect, useRef } from 'react';
import { UPDATE_AUTOMATION_TOOL_NAME } from '@nao/shared/automation-draft';
import type { AutomationDraftUpdate, AutomationDraftUpdateResult } from '@nao/shared/automation-draft';
import type { UIMessage } from '@nao/backend/chat';

import { useAgentMessages } from '@/contexts/agent.provider';
import { useChatId } from '@/hooks/use-chat-id';
import { getToolName, isToolSettled, isToolUIPart } from '@/lib/ai';
import { useChatQuery } from '@/queries/use-chat-query';

interface SettledDraftUpdate {
	toolCallId: string;
	update: AutomationDraftUpdate;
}

/**
 * Hands each change the agent makes to the automation over to its form, once.
 * A resumed conversation's past changes were already handed over when they were made.
 */
export function useAutomationDraftUpdates({
	isResumed,
	onUpdate,
}: {
	isResumed: boolean;
	onUpdate: (update: AutomationDraftUpdate) => void;
}) {
	const messages = useAgentMessages();
	const savedMessages = useChatQuery({ chatId: useChatId() }).data?.messages;
	const handledToolCallIds = useRef<Set<string> | null>(isResumed ? null : new Set());
	const onUpdateRef = useRef(onUpdate);
	onUpdateRef.current = onUpdate;

	useEffect(() => {
		if (!handledToolCallIds.current) {
			if (savedMessages) {
				handledToolCallIds.current = new Set(listSettledDraftUpdates(savedMessages).map(toToolCallId));
			}
			return;
		}

		for (const { toolCallId, update } of listSettledDraftUpdates(messages)) {
			if (handledToolCallIds.current.has(toolCallId)) {
				continue;
			}
			handledToolCallIds.current.add(toolCallId);
			onUpdateRef.current(update);
		}
	}, [messages, savedMessages]);
}

function toToolCallId({ toolCallId }: SettledDraftUpdate): string {
	return toolCallId;
}

function listSettledDraftUpdates(messages: UIMessage[]): SettledDraftUpdate[] {
	return messages.flatMap((message) =>
		message.parts.flatMap((part) => {
			if (!isToolUIPart(part) || getToolName(part) !== UPDATE_AUTOMATION_TOOL_NAME) {
				return [];
			}
			if (!isToolSettled(part) || part.state !== 'output-available') {
				return [];
			}
			const output = part.output as AutomationDraftUpdateResult;
			return [{ toolCallId: part.toolCallId, update: output.update }];
		}),
	);
}
