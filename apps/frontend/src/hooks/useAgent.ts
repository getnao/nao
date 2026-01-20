import { useNavigate, useParams } from '@tanstack/react-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useMemo, useEffect, useRef, useCallback } from 'react';
import { Chat as Agent, useChat } from '@ai-sdk/react';
import { DefaultChatTransport } from 'ai';
import { useCurrent } from './useCurrent';
import { useMemoObject } from './useMemoObject';
import type { UseChatHelpers } from '@ai-sdk/react';
import type { UIMessage } from 'backend/chat';
import { useChatQuery } from '@/queries/useChatQuery';
import { trpc } from '@/main';
import { agentService } from '@/lib/agents.service';
import { checkIsRunning } from '@/lib/ai';

export type AgentHelpers = {
	messages: UIMessage[];
	setMessages: UseChatHelpers<UIMessage>['setMessages'];
	sendMessage: UseChatHelpers<UIMessage>['sendMessage'];
	status: UseChatHelpers<UIMessage>['status'];
	isRunning: boolean;
	isReadyForNewMessages: boolean;
	stopAgent: () => Promise<void>;
};

export const useAgent = (): AgentHelpers => {
	const navigate = useNavigate();
	const { chatId } = useParams({ strict: false });
	const chat = useChatQuery({ chatId });
	const queryClient = useQueryClient();
	const chatIdRef = useCurrent(chatId);

	const agentInstance = useMemo(() => {
		let agentId = chatId ?? 'new-chat';
		const existingAgent = agentService.getAgent(agentId);
		if (existingAgent) {
			return existingAgent;
		}

		const newAgent = new Agent<UIMessage>({
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
			onData: ({ data: newChat }) => {
				// Move the chat instance to the new chat id
				agentService.moveAgent(agentId, newChat.id);

				// Update the agent id after moving the instance
				agentId = newChat.id;

				// Update the query data
				queryClient.setQueryData(trpc.chat.get.queryKey({ chatId: newChat.id }), (prev) => {
					return !prev
						? prev
						: {
								...prev,
								...newChat,
							};
				});

				// Update the chat list
				queryClient.setQueryData(trpc.chat.list.queryKey(), (old) => ({
					chats: [newChat, ...(old?.chats || [])],
				}));

				// Navigate to the new chat id
				navigate({ to: '/$chatId', params: { chatId: newChat.id } });
			},
			onFinish: () => {
				if (chatIdRef.current !== agentId) {
					agentService.disposeAgent(agentId);
				}
			},
			onError: (error) => {
				console.error(error);
			},
		});

		return agentService.registerAgent(agentId, newAgent);
	}, [chatId, navigate, queryClient, chatIdRef]);

	const agent = useChat({ chat: agentInstance });

	const stopAgentMutation = useMutation(trpc.chat.stop.mutationOptions());

	const stopAgent = useCallback(async () => {
		if (!chatId) {
			return;
		}

		agentInstance.stop(); // Stop the agent instance to instantly stop reading the stream
		await stopAgentMutation.mutateAsync({ chatId });
	}, [chatId, agentInstance, stopAgentMutation.mutateAsync]); // eslint-disable-line

	const isRunning = agent.status === 'streaming' || agent.status === 'submitted';

	return useMemoObject({
		messages: agent.messages,
		setMessages: agent.setMessages,
		sendMessage: agent.sendMessage,
		status: agent.status,
		isRunning,
		isReadyForNewMessages: chatId ? !!chat.data && !isRunning : true,
		stopAgent,
	});
};

/** Sync the messages between the useChat hook and the query client. */
export const useSyncMessages = ({ agent }: { agent: AgentHelpers }) => {
	const { chatId } = useParams({ strict: false });
	const queryClient = useQueryClient();
	const chat = useChatQuery({ chatId });

	// Sync the agent's messages with the fetched ones
	useEffect(() => {
		if (chat.data?.messages && !agent.isRunning) {
			agent.setMessages(chat.data.messages);
		}
	}, [chat.data?.messages, agent.isRunning, agent.setMessages]); // eslint-disable-line

	// Sync the fetched messages with the agent's
	useEffect(() => {
		if (agent.isRunning) {
			queryClient.setQueryData(trpc.chat.get.queryKey({ chatId }), (prev) =>
				!prev ? prev : { ...prev, messages: agent.messages },
			);
		}
	}, [queryClient, agent.messages, chatId, agent.isRunning]);
};

/** Dispose inactive agents to free up memory */
export const useDisposeInactiveAgents = () => {
	const chatId = useParams({ strict: false }).chatId;
	const prevChatIdRef = useRef(chatId);

	useEffect(() => {
		try {
			if (!prevChatIdRef.current || chatId === prevChatIdRef.current) {
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
