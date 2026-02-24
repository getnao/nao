import { useEffect, useMemo } from 'react';
import { useStickToBottomContext } from 'use-stick-to-bottom';
import type { UIMessage } from '@nao/backend/chat';
import { useAgentContext } from '@/contexts/agent.provider';

/** Smoothly scroll to the bottom of the chat when a new user message is added to the conversation. */
export const useScrollToBottomOnNewUserMessage = (messages: UIMessage[]) => {
	const { isRunning } = useAgentContext();
	const isNewUserMessage = useMemo(() => isRunning && messages.at(-1)?.role === 'user', [messages, isRunning]);
	const { scrollToBottom } = useStickToBottomContext();

	useEffect(() => {
		if (isNewUserMessage) {
			scrollToBottom();
		}
	}, [isNewUserMessage, scrollToBottom]);
};
