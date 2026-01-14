import { useNavigate, useParams } from '@tanstack/react-router';
import { useQueryClient } from '@tanstack/react-query';
import { useMemo, useEffect, useRef } from 'react';
import { Chat as Agent, useChat } from '@ai-sdk/react';
import { DefaultChatTransport, lastAssistantMessageIsCompleteWithToolCalls } from 'ai';
import { useCurrent } from './useCurrent';
import type { UseChatHelpers } from '@ai-sdk/react';
import type { UIMessage } from 'backend/chat';
import { useChatQuery } from '@/queries/useChatQuery';
import { trpc } from '@/main';
import { agentService } from '@/lib/agents';
import { checkIsRunning } from '@/lib/ai';

export type AgentHelpers = UseChatHelpers<UIMessage> & {
	isRunning: boolean;
	isReadyForNewMessages: boolean;
};

export const useAgent = (): AgentHelpers => {
	const navigate = useNavigate();
	const { chatId } = useParams({ strict: false });
	const chat = useChatQuery({ chatId });
	const queryClient = useQueryClient();
	const chatIdRef = useCurrent(chatId);

	const agentInstance = useMemo(() => {
		const originalChatId = chatId ?? 'new-chat';
		const existingAgent = agentService.getAgent(originalChatId);
		if (existingAgent) {
			return existingAgent;
		}

		const newAgent = new Agent<UIMessage>({
			id: originalChatId,
			transport: new DefaultChatTransport({
				api: '/api/chat/agent',
				prepareSendMessagesRequest: (options) => {
					return {
						body: {
							chatId: chatIdRef.current, // Using the ref to send new id when chat was created
							message: options.messages.at(-1),
						},
					};
				},
			}),
			onData: (chunk) => {
				const newChat = chunk.data;

				// Move the chat instance to the new chat id
				agentService.moveAgent(originalChatId, newChat.id);

				// Update the query data
				queryClient.setQueryData(trpc.chat.get.queryKey({ chatId: newChat.id }), {
					...chunk.data,
					messages: agentInstance.messages,
				});
				queryClient.setQueryData(trpc.chat.list.queryKey(), (old) => ({
					chats: [newChat, ...(old?.chats || [])],
				}));

				// Navigate to the new chat id
				navigate({ to: '/$chatId', params: { chatId: newChat.id } });
			},
			sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithToolCalls,
			onFinish: () => {
				// Dispose instances that are not open to free up memory
				if (chatIdRef.current !== agentInstance.id) {
					agentService.disposeAgent(agentInstance.id);
				}
			},
		});

		return agentService.registerAgent(originalChatId, newAgent);
	}, [chatId, navigate, queryClient, chatIdRef]);

	const agent = useChat({ chat: agentInstance });
	const { setMessages, messages, status } = agent;

	const isRunning = status === 'streaming' || status === 'submitted';

	// Sync the agent's messages with the fetched ones
	useEffect(() => {
		if (chat.data?.messages && !isRunning) {
			setMessages(chat.data.messages as UIMessage[]);
		}
	}, [chat.data?.messages, isRunning, setMessages]);

	// Sync the fetched messages with the agent's
	useEffect(() => {
		if (isRunning) {
			queryClient.setQueryData(trpc.chat.get.queryKey({ chatId }), (prev) =>
				!prev ? prev : { ...prev, messages },
			);
		}
	}, [queryClient, messages, chatId, isRunning]);

	return {
		...agent,
		isRunning,
		isReadyForNewMessages: chatId ? !!chat.data && !isRunning : true,
	};
};

/** Dispose inactive agents to free up memory */
export const useDisposeInactiveAgents = () => {
	const chatId = useParams({ strict: false }).chatId;
	const prevChatIdRef = useRef(chatId);

	useEffect(() => {
		try {
			if (!chatId || !prevChatIdRef.current || chatId === prevChatIdRef.current) {
				return;
			}

			const agentIdToDispose = prevChatIdRef.current;

			const agent = agentService.getAgent(agentIdToDispose);
			if (!agent) {
				return;
			}

			const isRunning = checkIsRunning(agent.status);
			if (!isRunning) {
				agentService.disposeAgent(agentIdToDispose);
			}
		} finally {
			prevChatIdRef.current = chatId;
		}
	}, [chatId]);
};
