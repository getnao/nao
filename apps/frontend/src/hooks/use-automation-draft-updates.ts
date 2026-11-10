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

/** The changes already handed to the form, per conversation. */
export type HandledDraftUpdates = Map<string, Set<string>>;

/**
 * Hands each change the agent makes to the automation over to its form, once.
 * A resumed conversation's past changes were already handed over when they were made.
 *
 * `handledUpdates` must outlive this hook: the chat unmounts when its panel is collapsed, and a change
 * handed over again on reopening would overwrite what the user edited in the form since.
 */
export function useAutomationDraftUpdates({
	isResumed,
	handledUpdates,
	onUpdate,
}: {
	isResumed: boolean;
	handledUpdates: HandledDraftUpdates;
	onUpdate: (update: AutomationDraftUpdate) => void;
}) {
	const chatId = useChatId();
	const messages = useAgentMessages();
	const savedMessages = useChatQuery({ chatId }).data?.messages;
	const onUpdateRef = useRef(onUpdate);
	onUpdateRef.current = onUpdate;

	useEffect(() => {
		if (!chatId) {
			return;
		}
		const handledToolCallIds = handledUpdates.get(chatId);
		if (!handledToolCallIds) {
			if (!isResumed) {
				handledUpdates.set(chatId, handUpdatesOver(messages, new Set(), onUpdateRef.current));
			} else if (savedMessages) {
				handledUpdates.set(chatId, new Set(listSettledDraftUpdates(savedMessages).map(toToolCallId)));
			}
			return;
		}
		handUpdatesOver(messages, handledToolCallIds, onUpdateRef.current);
	}, [chatId, handledUpdates, isResumed, messages, savedMessages]);
}

function handUpdatesOver(
	messages: UIMessage[],
	handledToolCallIds: Set<string>,
	onUpdate: (update: AutomationDraftUpdate) => void,
): Set<string> {
	for (const { toolCallId, update } of listSettledDraftUpdates(messages)) {
		if (handledToolCallIds.has(toolCallId)) {
			continue;
		}
		handledToolCallIds.add(toolCallId);
		onUpdate(update);
	}
	return handledToolCallIds;
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
