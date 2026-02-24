import { useEffect } from 'react';
import { useStickToBottomContext } from 'use-stick-to-bottom';
import type { UIMessage } from '@nao/backend/chat';
import { useAgentContext } from '@/contexts/agent.provider';

/** Smoothly scroll to the bottom of the chat when a new user message is added to the conversation. */
export const useScrollToBottomOnNewUserMessage = (messages: UIMessage[]) => {
	const { isRunning } = useAgentContext();
	const { scrollToBottom } = useStickToBottomContext();

	useEffect(() => {
		if (isRunning && messages.at(-1)?.role === 'user') {
			scrollToBottom();
		}
	}, [messages, isRunning, scrollToBottom]);
};
